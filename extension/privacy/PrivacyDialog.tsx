import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { getPrivacySections, PRIVACY_VERSION } from './content';
import { createTranslator } from '../../src/i18n';

export function PrivacyContent({ language }: { language?: string }) {
  const t = createTranslator(language);
  return (
    <>
      <p className="privacy-version">{t('extensionPrivacyVersion', { version: PRIVACY_VERSION })}</p>
      {getPrivacySections(language).map((section) => (
        <section key={section.title}>
          <h3>{section.title}</h3>
          <p>{section.text}</p>
        </section>
      ))}
    </>
  );
}

export function PrivacyDialog({ onClose, language }: { onClose: () => void; language?: string }) {
  const t = createTranslator(language);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="extension-privacy-dialog"
      aria-labelledby="privacy-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="privacy-dialog-title">{t('extensionPrivacy')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('extensionPrivacyClose')}
          title={`${t('extensionPrivacyClose')} (Esc)`}
        >
          <X size={20} />
        </button>
      </header>
      <div className="privacy-dialog-body" tabIndex={0}>
        <PrivacyContent language={language} />
      </div>
    </dialog>
  );
}
