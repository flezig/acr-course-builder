import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../entities/course/api/provider';
import { StoragePanel } from '../export-course/storage-panel';
import '../methodist-sign-in/sign-in-dialog.css';
import './settings-dialog.css';

// Режим работы и хранилище нужны редко, поэтому они живут в настройках, а не в шапке
// и на экране создания программы.
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { api, setMode } = useApi();
  const client = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const reset = async () => {
    if (
      window.confirm('Удалить все демонстрационные программы, версии и задачи в этом браузере?')
    ) {
      await api.reset();
      client.removeQueries({ queryKey: ['demo'] });
      onClose();
      navigate('/');
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="sign-in-dialog settings-dialog"
      aria-labelledby="settings-title"
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sign-in-card">
        <button className="sign-in-close" aria-label="Закрыть" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 id="settings-title">Настройки</h2>
        <label className="field">
          <span>Режим работы</span>
          <select
            aria-label="Режим работы"
            value={api.mode}
            onChange={(e) => {
              setMode(e.target.value as 'demo' | 'live');
              onClose();
              navigate('/');
            }}
          >
            <option value="demo">Demo</option>
            <option value="live">Live API</option>
          </select>
          <small>
            {api.mode === 'demo'
              ? 'Данные и задачи сохраняются в этом браузере. Генерация моделируется.'
              : 'Данные приходят с настроенного backend. При сбое demo не подставляется.'}
          </small>
        </label>
        {/* Панель читает объём хранилища при отрисовке: монтируем её при открытии,
            чтобы цифры были свежими. */}
        {open && <StoragePanel />}
        {api.mode === 'demo' && (
          <button className="settings-reset" onClick={() => void reset()}>
            <RotateCcw size={14} />
            Сбросить демоданные
          </button>
        )}
      </div>
    </dialog>
  );
}
