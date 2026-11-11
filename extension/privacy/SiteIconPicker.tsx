import { SiteIconPicker as SharedPicker } from '../../src/components/common/SiteIconPicker';
import type { ComponentProps } from 'react';
import { createTranslator } from '../../src/i18n';

export type { SiteIconChoice } from '../../src/components/common/SiteIconPicker';

export function SiteIconPicker(props: ComponentProps<typeof SharedPicker>) {
  const t = createTranslator(props.language);
  return (
    <div>
      <SharedPicker {...props} />
      <p className="extension-remote-image-notice">{t('extensionRemoteImageNotice')}</p>
    </div>
  );
}
