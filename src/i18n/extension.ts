import type { MessageTable } from './index';

export const extensionMessages = {
  extensionCaptureMenu: { zh: '收藏到记个球', en: 'Save to JIGEQIU' },
  extensionCaptureInvalid: {
    zh: '无法打开待收藏的网页。仅支持 HTTP 或 HTTPS 网页，请回到原网页重新使用“收藏到记个球”。',
    en: 'Unable to open this capture request. Only HTTP and HTTPS pages are supported. Return to the page and choose "Save to JIGEQIU" again.',
  },
  extensionCaptureClose: { zh: '关闭', en: 'Close' },
  localDataUnavailable: {
    zh: '本机数据暂时无法读取，或桌面加载出现异常。',
    en: 'Local data cannot be read right now, or the desktop could not load.',
  },
  localDataBackupFirst: {
    zh: '请先备份原始数据，再刷新重试。不要清除浏览器站点数据。',
    en: 'Back up the original data before refreshing. Do not clear browser site data.',
  },
  localDataBackup: { zh: '下载原始数据备份', en: 'Download original data backup' },
  localDataRetry: { zh: '刷新重试', en: 'Refresh and retry' },
  localDataBackupError: {
    zh: '浏览器未允许读取或下载备份。请保持现有站点数据，检查浏览器权限。',
    en: 'The browser did not allow reading or downloading the backup. Keep existing site data and check browser permissions.',
  },
  extensionBrand: { zh: '记个球', en: 'JIGEQIU' },
  extensionSubtitle: { zh: '浏览器新标签页扩展', en: 'New tab extension' },
  extensionPrivacy: { zh: '隐私说明', en: 'Privacy notice' },
  extensionPrivacyInitial: { zh: '使用前的隐私告知', en: 'Privacy before you begin' },
  extensionPrivacyVersion: { zh: '告知版本：{version}', en: 'Notice version: {version}' },
  extensionSummaryLocal: {
    zh: '收藏、设置及壁纸保存在当前浏览器，不提供云同步。',
    en: 'Bookmarks, settings and wallpapers stay in this browser. Cloud sync is not available.',
  },
  extensionSummaryPermissions: {
    zh: '扩展替换浏览器新标签页；未授权网站使用普通图片加载，不主动申请网站访问权限。',
    en: 'This extension replaces your new tab page. Sites without access permission use ordinary image loading; the extension does not request site access.',
  },
  extensionSummaryRemote: {
    zh: '远程图片、外部搜索、收藏链接及嵌入网页可能连接第三方网站，对方可能收到 IP、搜索词或浏览器请求信息。',
    en: 'Remote images, external searches, bookmarked links and embedded pages may connect to third parties, which may receive your IP address, search terms or browser request information.',
  },
  extensionSummaryIcons: {
    zh: '图标可能自动连接图片站点；提交搜索时会向所选服务发送搜索词。已有站点权限下的标题补全可能请求包含路径和查询参数的完整网址。',
    en: 'Icons may automatically connect to image sites. Submitting a search sends your query to the selected service. With existing site permission, title completion may request the full URL, including its path and query parameters.',
  },
  extensionPrivacyConsent: {
    zh: '这是应用内隐私告知，不会代替浏览器的权限授权。未确认前不会进入工作台。',
    en: 'This in-app notice does not grant browser permissions. The workbench will not open until you acknowledge it.',
  },
  extensionPrivacyFull: { zh: '完整隐私说明', en: 'Full privacy notice' },
  extensionPrivacyDeclined: {
    zh: '尚未进入工作台。你可以关闭本页，并在浏览器扩展管理页停用或移除记个球。',
    en: 'The workbench has not opened. You can close this page and disable or remove JIGEQIU in your browser extension settings.',
  },
  extensionPrivacyBack: { zh: '返回隐私告知', en: 'Back to privacy notice' },
  extensionPrivacyDecline: { zh: '暂不使用', en: 'Not now' },
  extensionPrivacyContinue: { zh: '知晓并继续', en: 'Acknowledge and continue' },
  extensionPrivacySaveError: {
    zh: '无法保存本地告知记录，未进入工作台。请检查浏览器存储权限后重试。',
    en: 'The local acknowledgment could not be saved. The workbench has not opened. Check browser storage permissions and try again.',
  },
  extensionReturn: { zh: '返回', en: 'Back' },
  extensionPrivacyOffline: {
    zh: '隐私说明随扩展提供，可离线查看。',
    en: 'This notice is included with the extension and available offline.',
  },
  extensionPrivacyClose: { zh: '关闭隐私说明', en: 'Close privacy notice' },
  extensionOpening: { zh: '正在打开工作台…', en: 'Opening the workbench...' },
  extensionReading: { zh: '正在读取本地数据…', en: 'Reading local data...' },
  extensionStorageErrorTitle: { zh: '无法读取或迁移本地数据', en: 'Unable to read or migrate local data' },
  extensionStorageError: {
    zh: '原有数据未删除。请勿卸载扩展，检查存储权限及可用空间后重试。',
    en: 'Your existing data has not been deleted. Do not uninstall the extension. Check storage permissions and available space, then try again.',
  },
  extensionReload: { zh: '重新加载', en: 'Reload' },
  extensionRemoteImageNotice: {
    zh: '加载远程图片会连接目标网站，对方可能收到你的 IP 地址、图片地址及浏览器请求信息；该请求也可能携带浏览器允许的目标站点 Cookie。仅填写你信任的图片链接。',
    en: 'Loading a remote image connects to its website, which may receive your IP address, the image URL and browser request information, as well as any cookies the browser allows for that site. Only enter image links you trust.',
  },
} as const satisfies MessageTable;
