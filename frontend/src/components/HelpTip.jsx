import { HelpCircle } from 'lucide-react';
import { useState } from 'react';

export default function HelpTip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block ml-1">
      <HelpCircle
        size={12}
        className="text-gray-600 hover:text-gray-400 cursor-help inline"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      />
      {show && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-[11px] text-gray-300 whitespace-normal w-48 shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}
