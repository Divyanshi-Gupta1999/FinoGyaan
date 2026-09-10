import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage } from '../types';
import { sendChatMessage } from '../services/geminiService';
import { Send, Bot, User } from 'lucide-react';

interface ChatProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  theme?: 'dark' | 'light';
}

const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  // Normalize triple asterisks or broken bold markers before rendering
  const normalized = content
    .replace(/\*\*\*+/g, '**')
    .replace(/([^\n])\n(\s*[\*\-]\s+)/g, '$1\n\n$2');

  return (
    <div className="text-sm leading-relaxed text-slate-800 dark:text-slate-200 space-y-2">
      <ReactMarkdown
        components={{
          h1: ({ node, ...props }) => <h3 className="text-base font-bold text-slate-900 dark:text-white mt-3 mb-1" {...props} />,
          h2: ({ node, ...props }) => <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-2.5 mb-1" {...props} />,
          h3: ({ node, ...props }) => <h4 className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mt-3 mb-1 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span {...props} /></h4>,
          p: ({ node, ...props }) => <p className="my-1.5 leading-relaxed text-slate-800 dark:text-slate-200" {...props} />,
          ul: ({ node, ...props }) => <ul className="my-2 space-y-1.5 pl-4 list-disc marker:text-emerald-500" {...props} />,
          ol: ({ node, ...props }) => <ol className="my-2 space-y-1.5 pl-4 list-decimal marker:text-emerald-500" {...props} />,
          li: ({ node, ...props }) => <li className="pl-1 leading-relaxed text-slate-800 dark:text-slate-200" {...props} />,
          strong: ({ node, ...props }) => <strong className="font-semibold text-slate-900 dark:text-white tracking-tight" {...props} />,
          code: ({ node, ...props }) => <code className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded text-xs font-mono" {...props} />,
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
};

const Chat: React.FC<ChatProps> = ({ messages, setMessages, theme = 'dark' }) => {
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input.trim()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const responseText = await sendChatMessage(userMsg.text);
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: "I encountered an error processing your request. Please try again."
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto p-4 sm:p-6 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col h-[calc(100vh-130px)] overflow-hidden shadow-2xl backdrop-blur-sm">
        
        {/* Chat Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 p-1 flex items-center justify-center shadow-sm flex-shrink-0">
              <img src="/finogyaan-icon.png" alt="FinoGyaan" className="w-full h-full object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-wide">FinoGyaan Strategy Advisor</h2>
                <span className="text-[10px] bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 px-2 py-0.5 rounded-full font-mono font-medium">Grounded in BigQuery</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Ask scenario questions, stress test allocations, or modify horizon</p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Online
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-grow overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-5 my-auto py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center shadow-xl">
                <Bot className="w-8 h-8 text-emerald-600/70 dark:text-emerald-400/60" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">Interactive Advisor Ready</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1">Ask questions about your plan's risk score, tax efficiency, or test custom life scenarios:</p>
              </div>
              <div className="flex gap-2 flex-wrap justify-center max-w-lg mt-2">
                <button 
                  onClick={() => setInput("What if I take a 6-month sabbatical in year 3?")} 
                  className="text-xs bg-white dark:bg-slate-950 hover:bg-emerald-50 dark:hover:bg-slate-800/80 border border-slate-300 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-slate-700 text-slate-800 dark:text-slate-300 px-3.5 py-2 rounded-xl transition-all shadow-sm active:scale-95 font-semibold"
                >
                  🌴 What if I take a 6-month sabbatical?
                </button>
                <button 
                  onClick={() => setInput("How does a spike in inflation affect this projection?")} 
                  className="text-xs bg-white dark:bg-slate-950 hover:bg-emerald-50 dark:hover:bg-slate-800/80 border border-slate-300 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-slate-700 text-slate-800 dark:text-slate-300 px-3.5 py-2 rounded-xl transition-all shadow-sm active:scale-95 font-semibold"
                >
                  📈 How does higher inflation affect this?
                </button>
                <button 
                  onClick={() => setInput("Can we make the asset allocation more aggressive for higher returns?")} 
                  className="text-xs bg-white dark:bg-slate-950 hover:bg-emerald-50 dark:hover:bg-slate-800/80 border border-slate-300 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-slate-700 text-slate-800 dark:text-slate-300 px-3.5 py-2 rounded-xl transition-all shadow-sm active:scale-95 font-semibold"
                >
                  🚀 Make portfolio more aggressive
                </button>
              </div>
            </div>
          )}
          
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center shadow-md ${
                msg.role === 'user' ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-blue-500/25' : 'bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-emerald-500/25'
              }`}>
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className={`max-w-[82%] rounded-2xl px-5 py-3.5 shadow-md ${
                msg.role === 'user' 
                  ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-tr-none shadow-blue-500/20' 
                  : 'bg-white dark:bg-slate-950 border border-slate-200/90 dark:border-slate-800 text-slate-900 dark:text-slate-200 rounded-tl-none shadow-slate-200/50 dark:shadow-none'
              }`}>
                <div className="text-sm leading-relaxed font-medium">
                  {msg.role === 'user' ? (
                    <div className="whitespace-pre-wrap">{msg.text}</div>
                  ) : (
                    <MarkdownRenderer content={msg.text} />
                  )}
                </div>
              </div>
            </div>
          ))}
          
          {isTyping && (
            <div className="flex gap-3.5">
              <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="bg-slate-50 dark:bg-slate-950 rounded-2xl rounded-tl-none px-5 py-4 border border-slate-200 dark:border-slate-800 flex items-center gap-2 shadow-md">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" style={{ animationDelay: '200ms' }}></div>
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" style={{ animationDelay: '400ms' }}></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-slate-50/90 dark:bg-slate-950/80 border-t border-slate-200 dark:border-slate-800/80">
          <div className="relative flex items-center">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask FinoGyaan a question or simulate market conditions... (Press Enter to send)"
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl pl-4 pr-12 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 resize-none overflow-hidden min-h-[48px] max-h-[140px] transition-all"
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className="absolute right-2.5 p-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md active:scale-95"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-center text-[11px] text-slate-500 dark:text-slate-400 mt-2 font-mono">
            Grounded in BigQuery historical time series. Verify critical financial decisions with licensed professionals.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Chat;