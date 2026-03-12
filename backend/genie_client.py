import asyncio
import time
import logging
import httpx
from databricks import sdk

logger = logging.getLogger("genie-loadtest")

DEFAULT_MAX_RETRIES = 5
DEFAULT_RETRY_BASE_DELAY = 2.0  # seconds, exponential backoff


class GenieClient:
    """Client for Databricks Genie API using databricks-sdk auth."""

    def __init__(self, max_retries=None, retry_base_delay=None, poll_interval=None, max_poll_time=None):
        self.w = sdk.WorkspaceClient()
        self.base_url = f"{self.w.config.host}/api/2.0/genie/spaces"
        self.poll_interval = poll_interval if poll_interval is not None else 2.0
        self.max_poll_time = max_poll_time if max_poll_time is not None else 300
        self.max_retries = max_retries if max_retries is not None else DEFAULT_MAX_RETRIES
        self.retry_base_delay = retry_base_delay if retry_base_delay is not None else DEFAULT_RETRY_BASE_DELAY

    def _headers(self):
        """Get fresh auth headers from the SDK."""
        token = self.w.config.authenticate()
        return {
            **token,
            "Content-Type": "application/json",
        }

    async def _request_with_retry(self, client, method, url, **kwargs):
        """Make an HTTP request with exponential backoff on 429s.
        Returns (response, retry_count, backoff_time_ms)."""
        total_retries = 0
        total_backoff = 0.0
        for attempt in range(self.max_retries):
            resp = await getattr(client, method)(url, headers=self._headers(), **kwargs)
            if resp.status_code == 429:
                retry_after = self.retry_base_delay * (2 ** attempt)
                logger.warning(f"429 on {url}, retry {attempt+1}/{self.max_retries} after {retry_after:.1f}s")
                total_retries += 1
                total_backoff += retry_after * 1000
                await asyncio.sleep(retry_after)
                continue
            resp.raise_for_status()
            return resp, total_retries, total_backoff
        # Final attempt — let it raise
        resp = await getattr(client, method)(url, headers=self._headers(), **kwargs)
        resp.raise_for_status()
        return resp, total_retries, total_backoff

    async def start_conversation(self, space_id: str, question: str) -> dict:
        """Start a new Genie conversation with an initial question."""
        url = f"{self.base_url}/{space_id}/start-conversation"
        payload = {"content": question}

        start_time = time.time()
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp, retries, backoff = await self._request_with_retry(client, "post", url, json=payload)
            data = resp.json()

        conversation_id = data.get("conversation_id", "")
        message_id = data.get("message_id", "")
        first_response_time = time.time()

        result = await self._poll_message(
            space_id, conversation_id, message_id, first_response_time
        )
        result["start_time"] = start_time
        result["first_response_time"] = first_response_time
        result["conversation_id"] = conversation_id
        result["message_id"] = message_id
        result["http_status"] = resp.status_code
        result["retry_count"] = retries + result.get("poll_retries", 0)
        result["backoff_time_ms"] = backoff + result.get("poll_backoff_ms", 0)
        return result

    async def create_message(
        self, space_id: str, conversation_id: str, question: str
    ) -> dict:
        """Send a follow-up message in an existing conversation."""
        url = f"{self.base_url}/{space_id}/conversations/{conversation_id}/messages"
        payload = {"content": question}

        start_time = time.time()
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp, retries, backoff = await self._request_with_retry(client, "post", url, json=payload)
            data = resp.json()

        message_id = data.get("id", "")
        first_response_time = time.time()

        result = await self._poll_message(
            space_id, conversation_id, message_id, first_response_time
        )
        result["start_time"] = start_time
        result["first_response_time"] = first_response_time
        result["conversation_id"] = conversation_id
        result["message_id"] = message_id
        result["http_status"] = resp.status_code
        result["retry_count"] = retries + result.get("poll_retries", 0)
        result["backoff_time_ms"] = backoff + result.get("poll_backoff_ms", 0)
        return result

    async def _poll_message(
        self,
        space_id: str,
        conversation_id: str,
        message_id: str,
        poll_start: float,
    ) -> dict:
        """Poll until message is complete or timeout."""
        url = (
            f"{self.base_url}/{space_id}/conversations/"
            f"{conversation_id}/messages/{message_id}"
        )
        terminal_states = {"COMPLETED", "FAILED", "CANCELLED", "EXPIRED"}
        poll_retries = 0
        poll_backoff_ms = 0.0

        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                elapsed = time.time() - poll_start
                if elapsed > self.max_poll_time:
                    return {
                        "completed_time": time.time(),
                        "status": "timeout",
                        "error": f"Polling timeout after {self.max_poll_time}s",
                        "poll_retries": poll_retries,
                        "poll_backoff_ms": poll_backoff_ms,
                    }

                try:
                    resp, retries, backoff = await self._request_with_retry(client, "get", url)
                    poll_retries += retries
                    poll_backoff_ms += backoff
                    data = resp.json()
                    status = data.get("status", "UNKNOWN")

                    if status in terminal_states:
                        error = None
                        if status != "COMPLETED":
                            error = data.get("error", {}).get(
                                "message", f"Message {status}"
                            )
                        response_type = status.lower()
                        return {
                            "completed_time": time.time(),
                            "status": status.lower(),
                            "error": error,
                            "response_type": response_type,
                            "poll_retries": poll_retries,
                            "poll_backoff_ms": poll_backoff_ms,
                        }
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 429:
                        poll_retries += 1
                        poll_backoff_ms += self.retry_base_delay * 1000
                        await asyncio.sleep(self.retry_base_delay)
                        continue
                    return {
                        "completed_time": time.time(),
                        "status": "error",
                        "error": f"HTTP {e.response.status_code}: {e.response.text[:200]}",
                        "poll_retries": poll_retries,
                        "poll_backoff_ms": poll_backoff_ms,
                    }
                except Exception as e:
                    return {
                        "completed_time": time.time(),
                        "status": "error",
                        "error": str(e)[:200],
                        "poll_retries": poll_retries,
                        "poll_backoff_ms": poll_backoff_ms,
                    }

                await asyncio.sleep(self.poll_interval)
