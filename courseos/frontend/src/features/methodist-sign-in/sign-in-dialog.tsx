import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Form } from '../../shared/ui/form';
import './sign-in-dialog.css';

// Макет входа: авторизации на backend пока нет, поэтому форма только проверяет поля
// и честно сообщает, что вход не подключён.
export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setSubmitted(false);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
  };

  return (
    <dialog
      ref={dialogRef}
      className="sign-in-dialog"
      aria-labelledby="sign-in-title"
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sign-in-card">
        <button className="sign-in-close" aria-label="Закрыть" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 id="sign-in-title">Вход для методиста</h2>
        <p className="sign-in-lead">Войдите, чтобы работать со своими программами.</p>
        <Form className="sign-in-form" onSubmit={submit}>
          <input name="name" placeholder="Имя" aria-label="Имя" autoComplete="name" required />
          <input
            name="email"
            type="email"
            placeholder="Рабочая почта"
            aria-label="Рабочая почта"
            autoComplete="email"
            required
          />
          <input
            name="phone"
            type="tel"
            placeholder="Телефон"
            aria-label="Телефон"
            autoComplete="tel"
          />
          <label className="sign-in-consent">
            <input type="checkbox" name="marketing" />
            <span>
              Даю согласие на получение материалов о сервисе и приглашений на мероприятия в
              соответствии с <a href="#">Политикой конфиденциальности</a>.
            </span>
          </label>
          <button type="submit" className="sign-in-submit">
            Войти
          </button>
          {submitted && (
            <p className="sign-in-status" role="status">
              Вход пока не подключён — это макет формы.
            </p>
          )}
          <p className="sign-in-note">
            Нажимая на кнопку, я соглашаюсь на обработку моих персональных данных в соответствии с{' '}
            <a href="#">Политикой конфиденциальности</a>.
          </p>
        </Form>
      </div>
    </dialog>
  );
}
