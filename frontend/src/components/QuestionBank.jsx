import React, { useState, useEffect } from 'react';
import { getQuestions, addQuestion, addQuestionsBulk, deleteQuestion } from '../utils/api';
import { Trash2, Plus, Upload } from 'lucide-react';

export default function QuestionBank({ spaceId }) {
  const [questions, setQuestions] = useState([]);
  const [newQ, setNewQ] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (spaceId) loadQuestions();
  }, [spaceId]);

  async function loadQuestions() {
    setLoading(true);
    try {
      const data = await getQuestions(spaceId);
      setQuestions(data);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!newQ.trim()) return;
    await addQuestion(spaceId, newQ.trim());
    setNewQ('');
    loadQuestions();
  }

  async function handleBulkAdd() {
    const qs = bulkText.split('\n').map(q => q.trim()).filter(Boolean);
    if (qs.length === 0) return;
    await addQuestionsBulk(spaceId, qs);
    setBulkText('');
    setShowBulk(false);
    loadQuestions();
  }

  async function handleDelete(id) {
    await deleteQuestion(id);
    loadQuestions();
  }

  if (!spaceId) {
    return (
      <div className="text-gray-500 text-sm p-4">Enter a Genie Space ID above to manage questions.</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newQ}
          onChange={e => setNewQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Type a question..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleAdd}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-1 transition-colors"
        >
          <Plus size={14} /> Add
        </button>
        <button
          onClick={() => setShowBulk(!showBulk)}
          className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-1 transition-colors"
        >
          <Upload size={14} /> Bulk
        </button>
      </div>

      {showBulk && (
        <div className="space-y-2">
          <textarea
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder="Paste questions, one per line..."
            rows={5}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
          />
          <button
            onClick={handleBulkAdd}
            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          >
            Add {bulkText.split('\n').filter(l => l.trim()).length} Questions
          </button>
        </div>
      )}

      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {loading ? (
          <div className="text-gray-500 text-sm animate-pulse">Loading...</div>
        ) : questions.length === 0 ? (
          <div className="text-gray-500 text-sm">No questions yet. Add some above.</div>
        ) : (
          questions.map((q, i) => (
            <div key={q.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2 group">
              <span className="text-sm text-gray-300 flex-1">
                <span className="text-gray-500 mr-2">{i + 1}.</span>
                {q.question}
              </span>
              <button
                onClick={() => handleDelete(q.id)}
                className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all ml-2"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="text-xs text-gray-500">
        {questions.length} question{questions.length !== 1 ? 's' : ''} for space {spaceId.slice(0, 12)}...
      </div>
    </div>
  );
}
