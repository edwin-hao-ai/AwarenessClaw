import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function SettingsToggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`settings-toggle ${checked ? 'is-on' : ''}`}
      aria-pressed={checked}
    >
      <div
        className="settings-toggle-knob"
        style={{ transform: checked ? 'translateX(21px)' : 'translateX(1px)' }}
      />
    </button>
  );
}

export function SettingsSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="settings-section-title">{title}</h3>
      <div className="settings-glass-card divide-y divide-slate-700/30">
        {children}
      </div>
    </div>
  );
}

export function SettingsRow({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="flex-1 mr-4">
        <div className="settings-row-label">{label}</div>
        {desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsModalShell({
  title,
  onClose,
  children,
  footer,
  maxWidthClass = 'max-w-2xl',
  maxHeightClass = 'max-h-[85vh]',
  paddingClass = 'p-5',
  zIndexClass = 'z-50',
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClass?: string;
  maxHeightClass?: string;
  paddingClass?: string;
  zIndexClass?: string;
}) {
  return (
    <div className={`fixed inset-0 bg-black/50 flex items-center justify-center ${zIndexClass} p-8`}>
      <div className={`settings-glass-card w-full ${maxWidthClass} ${maxHeightClass} overflow-hidden flex flex-col`}>
        <div className="flex items-center justify-between p-5 border-b border-slate-700/30">
          <div className="text-lg font-semibold text-slate-100">{title}</div>
          <button onClick={onClose} className="settings-btn settings-btn-secondary px-2.5 py-2">
            <X size={20} />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto ${paddingClass}`}>
          {children}
        </div>
        {footer && <div className="border-t border-slate-700/30">{footer}</div>}
      </div>
    </div>
  );
}