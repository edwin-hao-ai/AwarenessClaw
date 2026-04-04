/**
 * WorkflowRunner — shows live execution progress of a Lobster workflow.
 * Displays a linear pipeline with step status badges + approval gates.
 */

import { Loader2, Check, X, AlertCircle, Clock, Shield } from 'lucide-react';
import type { WorkflowRun, StepResult, StepStatus } from '../../lib/task-store';

interface WorkflowStepDef {
  id: string;
  type: string;
  approval?: boolean;
}

interface WorkflowRunnerProps {
  t: (key: string, fallback?: string) => string;
  run: WorkflowRun;
  steps: readonly WorkflowStepDef[];
  onApprove?: (resumeToken: string) => void;
  onReject?: (resumeToken: string) => void;
  onClose?: () => void;
}

const STATUS_CONFIG: Record<StepStatus | 'unknown', {
  icon: typeof Check;
  color: string;
  bgColor: string;
  label: string;
}> = {
  pending: { icon: Clock, color: 'text-slate-500', bgColor: 'bg-slate-800', label: 'Pending' },
  running: { icon: Loader2, color: 'text-sky-400', bgColor: 'bg-sky-900/30', label: 'Running' },
  completed: { icon: Check, color: 'text-emerald-400', bgColor: 'bg-emerald-900/20', label: 'Done' },
  failed: { icon: X, color: 'text-red-400', bgColor: 'bg-red-900/20', label: 'Failed' },
  skipped: { icon: AlertCircle, color: 'text-slate-500', bgColor: 'bg-slate-800', label: 'Skipped' },
  unknown: { icon: Clock, color: 'text-slate-500', bgColor: 'bg-slate-800', label: '' },
};

function getStepStatus(run: WorkflowRun, stepId: string): StepStatus {
  return run.stepResults[stepId]?.status || 'pending';
}

export default function WorkflowRunner({
  t,
  run,
  steps,
  onApprove,
  onReject,
  onClose,
}: WorkflowRunnerProps) {
  const isRunning = run.status === 'running';
  const needsApproval = run.status === 'needs_approval';

  return (
    <div className="bg-slate-800/40 rounded-xl border border-slate-700/40 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Loader2
            size={16}
            className={isRunning ? 'animate-spin text-sky-400' : needsApproval ? 'text-amber-400' : 'text-emerald-400'}
          />
          <h3 className="text-sm font-semibold text-slate-200">
            {run.workflowName}
          </h3>
          <span className={`
            text-[10px] px-2 py-0.5 rounded-full font-medium
            ${run.status === 'running' ? 'bg-sky-900/40 text-sky-400' : ''}
            ${run.status === 'needs_approval' ? 'bg-amber-900/40 text-amber-400' : ''}
            ${run.status === 'completed' ? 'bg-emerald-900/40 text-emerald-400' : ''}
            ${run.status === 'failed' ? 'bg-red-900/40 text-red-400' : ''}
            ${run.status === 'cancelled' ? 'bg-slate-700 text-slate-400' : ''}
          `}>
            {t(`workflow.status.${run.status}`, run.status)}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Pipeline visualization */}
      <div className="flex items-center gap-0 overflow-x-auto pb-2">
        {steps.map((step, i) => {
          const status = getStepStatus(run, step.id);
          const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;
          const Icon = cfg.icon;
          const isCurrent = run.currentStepId === step.id;

          return (
            <div key={step.id} className="flex items-center">
              {/* Step node */}
              <div className={`
                flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all
                ${isCurrent ? 'ring-2 ring-sky-500/40 ' : ''}
                ${cfg.bgColor} border-slate-700/50
              `}>
                <Icon
                  size={14}
                  className={`${cfg.color} ${status === 'running' ? 'animate-spin' : ''}`}
                />
                <span className={`text-xs font-medium ${cfg.color}`}>
                  {step.id}
                </span>
                {step.approval && (
                  <Shield size={10} className="text-amber-500 ml-0.5" />
                )}
              </div>

              {/* Connector arrow */}
              {i < steps.length - 1 && (
                <div className={`
                  w-6 h-px mx-0.5 flex-shrink-0
                  ${status === 'completed' ? 'bg-emerald-600' : 'bg-slate-700'}
                `} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step output preview */}
      {run.currentStepId && run.stepResults[run.currentStepId]?.output && (
        <div className="mt-3 p-3 rounded-lg bg-slate-900/50 border border-slate-700/40">
          <p className="text-[11px] text-slate-500 mb-1">
            Output from <span className="text-slate-300">{run.currentStepId}</span>:
          </p>
          <p className="text-xs text-slate-400 line-clamp-4 whitespace-pre-wrap">
            {run.stepResults[run.currentStepId].output}
          </p>
        </div>
      )}

      {/* Approval gate buttons */}
      {needsApproval && run.resumeToken && (
        <div className="mt-4 flex items-center gap-3 p-3 rounded-lg bg-amber-950/20 border border-amber-700/30">
          <Shield size={18} className="text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-amber-300 font-medium">
              {t('workflow.status.needsApproval')}
            </p>
            <p className="text-xs text-amber-400/60 mt-0.5">
              {run.currentStepId ? `Step: ${run.currentStepId}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {onReject && (
              <button
                onClick={() => onReject(run.resumeToken!)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors border border-slate-600"
              >
                {t('workflow.reject')}
              </button>
            )}
            {onApprove && (
              <button
                onClick={() => onApprove(run.resumeToken!)}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition-colors"
              >
                {t('workflow.approve')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
