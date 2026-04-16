import { useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, Loader2, MessageSquare, X } from 'lucide-react';
import api from '../api/client';
import useAppStore from '../stores/appStore';

const QUICK_QUESTIONS = [
    'Which operator is most efficient?',
    'Why are tasks delayed?',
    'Which machine is the current bottleneck?',
];

export default function GlobalAIAssistantModal() {
    const closeModal = useAppStore((state) => state.closeGlobalAIModal);
    const addAlert = useAppStore((state) => state.addAlert);
    const [question, setQuestion] = useState('');
    const [loading, setLoading] = useState(false);
    const [answer, setAnswer] = useState(null);

    const askQuestion = async (nextQuestion) => {
        const prompt = nextQuestion.trim();
        if (prompt.length < 3) {
            addAlert('Ask a slightly more detailed question.', 'warning');
            return;
        }

        setLoading(true);
        try {
            const { data } = await api.post('/ai/assistant', { question: prompt });
            setAnswer(data);
            setQuestion(prompt);
        } catch (error) {
            addAlert(error.response?.data?.detail || 'Unable to reach the AI assistant.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        await askQuestion(question);
    };

    return (
        <div className="modal-overlay" onClick={closeModal}>
            <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 14, scale: 0.98 }}
                className="modal-shell w-full max-w-2xl rounded-[30px] p-7 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Global AI assistant</p>
                        <h2 className="font-display mt-2 text-3xl tracking-tight text-text-primary">Ask the business anything</h2>
                        <p className="mt-2 text-sm text-text-secondary">
                            Get role-aware answers about operators, delays, bottlenecks, costs, and output.
                        </p>
                    </div>
                    <button type="button" onClick={closeModal} className="modal-close">
                        <X size={14} />
                        Close
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                    <textarea
                        value={question}
                        onChange={(event) => setQuestion(event.target.value)}
                        rows={4}
                        placeholder="Why are tasks delayed today?"
                        className="input-glass w-full rounded-2xl px-4 py-4 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                        {QUICK_QUESTIONS.map((item) => (
                            <button
                                key={item}
                                type="button"
                                onClick={() => {
                                    setQuestion(item);
                                    void askQuestion(item);
                                }}
                                className="btn-ghost rounded-full px-3 py-2 text-xs font-semibold"
                            >
                                {item}
                            </button>
                        ))}
                    </div>
                    <div className="flex justify-end">
                        <button type="submit" disabled={loading} className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold">
                            {loading ? (
                                <span className="inline-flex items-center gap-2">
                                    <Loader2 size={14} className="animate-spin" />
                                    Thinking...
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-2">
                                    <Brain size={14} />
                                    Ask assistant
                                </span>
                            )}
                        </button>
                    </div>
                </form>

                <div className="mt-6 glass-card rounded-2xl p-5">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">
                        <MessageSquare size={14} />
                        Answer
                    </div>
                    {answer ? (
                        <div className="mt-4 space-y-4">
                            <p className="text-base font-medium text-text-primary">{answer.answer}</p>
                            {Array.isArray(answer.highlights) && answer.highlights.length > 0 && (
                                <div className="space-y-2">
                                    {answer.highlights.map((item) => (
                                        <div key={item} className="rounded-xl bg-black/10 px-3 py-3 text-sm text-text-secondary">
                                            {item}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {Array.isArray(answer.suggested_questions) && answer.suggested_questions.length > 0 && (
                                <div className="pt-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Suggested follow-ups</p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {answer.suggested_questions.map((item) => (
                                            <button
                                                key={item}
                                                type="button"
                                                onClick={() => {
                                                    setQuestion(item);
                                                    void askQuestion(item);
                                                }}
                                                className="btn-ghost rounded-full px-3 py-2 text-xs font-semibold"
                                            >
                                                {item}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="mt-4 text-sm text-text-muted">
                            Ask about productivity, bottlenecks, operator performance, or projected output.
                        </p>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
