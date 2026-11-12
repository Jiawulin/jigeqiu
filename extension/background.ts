import { captureChrome } from './capture/chrome';
import { CAPTURE_COMMAND, MENU_ID, createCaptureController } from './capture/controller';
import { browserLanguages } from '../src/i18n/locale';
import { STATE_KEY } from './storage/local';

const chrome = captureChrome();
const controller = createCaptureController({
  session: chrome.storage.session, local: chrome.storage.local,
  menus: chrome.contextMenus, windows: chrome.windows,
  getURL: path => chrome.runtime.getURL(path),
  languages: browserLanguages, uuid: () => crypto.randomUUID(),
});
const report = (task: Promise<unknown>) => {
  // Do not log captured URLs or page titles.
  void task.catch(() => console.error('JIGEQIU capture operation failed'));
};
chrome.runtime.onInstalled.addListener(() => report(controller.syncMenu()));
chrome.runtime.onStartup.addListener(() => {
  report(controller.syncMenu());
  report(controller.prune());
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.hasOwn(changes, STATE_KEY)) report(controller.syncMenu());
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) report(captureCurrentPage(tab));
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== CAPTURE_COMMAND) return;
  report(captureCurrentPage(tab));
});
chrome.windows.onRemoved.addListener(id => report(controller.closed(id)));
report(controller.syncMenu());

export async function captureCurrentPage(tab?: { url?: string; title?: string; windowId?: number }) {
  const current = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  await controller.open(current);
}
