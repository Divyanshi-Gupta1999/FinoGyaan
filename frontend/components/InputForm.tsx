import React from 'react';
import { UserProfile } from '../types';
import { DollarSign, Target, Clock, ShieldAlert, Wallet, Flag, ChevronDown } from 'lucide-react';

interface InputFormProps {
  profile: UserProfile;
  onChange: (profile: UserProfile) => void;
  onSubmit: () => void;
  isLoading: boolean;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

const InputForm: React.FC<InputFormProps> = ({ profile, onChange, onSubmit, isLoading }) => {
  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    onChange({
      ...profile,
      [name]: parseFloat(value) || 0
    });
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    onChange({
      ...profile,
      [name]: value
    });
  };

  const currencySymbol = profile.market === 'US' ? '$' : '₹';
  const isSpecificMilestone = profile.objective === 'MILESTONE';

  return (
    <div className="bg-white dark:bg-slate-900/95 border-r border-slate-200 dark:border-slate-800/80 w-full md:w-80 p-6 flex flex-col h-full overflow-y-auto custom-scrollbar shadow-sm dark:shadow-xl backdrop-blur-sm select-none transition-colors duration-200">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200 dark:border-slate-800/80">
        <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 p-1.5 flex items-center justify-center shadow-sm flex-shrink-0">
          <img 
            src="/finogyaan-icon.png" 
            alt="FinoGyaan" 
            className="w-full h-full object-contain" 
          />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center leading-tight">
            FinoGyaan
          </h1>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tracking-tight mt-0.5">Institutional Wealth Advisor</p>
        </div>
      </div>

      <div className="space-y-4 flex-grow">
        
        {/* Objective Selection */}
        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 select-none">
            <Flag className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            <span>Investment Objective</span>
          </label>
          <div className="relative flex items-center">
            <select
              name="objective"
              value={profile.objective}
              onChange={handleSelectChange}
              className="w-full bg-slate-50 dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800 rounded-xl pl-3.5 pr-10 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all appearance-none cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 truncate"
            >
              <option value="MILESTONE">Specific Milestone (House, Car, etc.)</option>
              <option value="FIRE">Long-Term Compounding / FIRE</option>
              <option value="RETIREMENT">Retirement Corpus Planning</option>
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3" />
          </div>
        </div>

        {/* Risk Profile */}
        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 select-none">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span>Risk Tolerance</span>
          </label>
          <div className="relative flex items-center">
            <select
              name="riskProfile"
              value={profile.riskProfile}
              onChange={handleSelectChange}
              className="w-full bg-slate-50 dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800 rounded-xl pl-3.5 pr-10 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all appearance-none cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 truncate"
            >
              <option value="CONSERVATIVE">Conservative (Capital Preservation)</option>
              <option value="MODERATE">Moderate (Balanced Growth)</option>
              <option value="AGGRESSIVE">Aggressive (Max Equity Compounding)</option>
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3" />
          </div>
        </div>

        <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80"></div>

        {/* Financials */}
        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 select-none">
            <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            <span>Monthly Income ({currencySymbol})</span>
          </label>
          <input
            type="number"
            name="income"
            value={profile.income || ''}
            onChange={handleNumberChange}
            className="w-full bg-slate-50 dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all hover:border-slate-300 dark:hover:border-slate-700 tabular-nums"
            placeholder="e.g. 150000"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 select-none">
            <Wallet className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <span>Fixed Expenses ({currencySymbol})</span>
          </label>
          <input
            type="number"
            name="expenses"
            value={profile.expenses || ''}
            onChange={handleNumberChange}
            className="w-full bg-slate-50 dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all hover:border-slate-300 dark:hover:border-slate-700 tabular-nums"
            placeholder="e.g. 60000"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 select-none">
            <DollarSign className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0" />
            <span>Current Capital ({currencySymbol})</span>
          </label>
          <input
            type="number"
            name="capital"
            value={profile.capital || ''}
            onChange={handleNumberChange}
            className="w-full bg-slate-50 dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all hover:border-slate-300 dark:hover:border-slate-700 tabular-nums"
            placeholder="e.g. 500000"
          />
        </div>

        {/* Conditional Milestone Fields */}
        {isSpecificMilestone && (
          <div className="space-y-4 pt-1 animate-in slide-in-from-top-2 duration-300">
            <div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 select-none">
                <Target className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <span>Target Goal ({currencySymbol})</span>
              </label>
              <input
                type="number"
                name="goalAmount"
                value={profile.goalAmount || ''}
                onChange={handleNumberChange}
                className="w-full bg-slate-50 dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all hover:border-slate-300 dark:hover:border-slate-700 tabular-nums"
                placeholder={profile.market === 'US' ? 'e.g. 250000' : 'e.g. 2500000'}
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 select-none">
                <Clock className="w-4 h-4 text-cyan-600 dark:text-cyan-400 flex-shrink-0" />
                <span>Goal Horizon (Years)</span>
              </label>
              <input
                type="number"
                name="goalHorizon"
                value={profile.goalHorizon || ''}
                onChange={handleNumberChange}
                className="w-full bg-slate-50 dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all hover:border-slate-300 dark:hover:border-slate-700 tabular-nums"
                placeholder="e.g. 7"
              />
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onSubmit}
        disabled={isLoading}
        className={`mt-6 w-full py-3 px-4 rounded-xl font-medium text-sm text-white transition-all duration-200 flex items-center justify-center gap-2 flex-shrink-0 shadow-sm active:scale-[0.99]
          ${isLoading 
            ? 'bg-emerald-700/60 cursor-wait' 
            : 'bg-emerald-600 hover:bg-emerald-500'
          }`}
      >
        {isLoading ? (
          <>
            <svg className="animate-spin -ml-1 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="font-medium">Synthesizing Strategy...</span>
          </>
        ) : (
          <span className="font-medium">Generate Autonomous Plan</span>
        )}
      </button>
    </div>
  );
};

export default InputForm;
