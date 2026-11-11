import { extensionMessages } from './extension';
import { selectLocale } from './locale';

const REMOTE_IMAGE_NOTICE = extensionMessages.extensionRemoteImageNotice.zh;

const privacySectionsZh = [
  {
    title: '适用范围与用途',
    text: '本政策适用于“记个球 JIGEQIU”浏览器新标签页扩展，不代表浏览器厂商的隐私政策。扩展的主要用途是个人网址收藏、新标签页快捷访问与搜索。收藏整理、本地偏好、图标展示和搜索所需的数据只用于这些用户可见功能。发布者身份及联系渠道以扩展商店条目中的开发者信息为准。',
  },
  {
    title: '本地数据',
    text: '你输入或导入的收藏标题、网址、备注、标签、目录、网址单、搜索引擎配置，以及偏好、最近搜索及应用内使用记录等保存在当前扩展的 chrome.storage.local 中。升级时自动迁移旧 LocalStorage 数据，核对写入结果后启用新存储；旧数据保留在本地，不再作为日常读写来源。自定义壁纸与图标缓存保存在本地 IndexedDB。应用内记录用于本扩展的最近使用、搜索和展示，不读取浏览器原生历史记录。当前扩展不提供账号云同步，也不将这些本地数据上传到开发者服务器；不集成广告或第三方使用分析追踪服务。',
  },
  {
    title: '浏览器权限与新标签页',
    text: '扩展将新标签页替换为记个球工作台，申请 storage 权限以保存本地数据。不申请 favicon、浏览器原生书签、浏览历史、标签页管理或默认的所有网站访问权限，不注入其他网站页面。清单保留 HTTPS 站点可选权限声明，但当前不主动申请，也不提供授权按钮；已有站点权限可在浏览器扩展管理中撤销。这里的“知晓并继续”仅是应用内告知确认，不会授予网站访问权限。',
  },
  {
    title: '自动网站图标',
    text: '未授权站点不进行图标或网页元数据的 fetch 读取，仅尝试普通图片展示或文字回退，图片仍可能联网。授权后可能读取该站点的 favicon、常见图标文件、首页 HTML 及声明的 manifest、图标或 Logo。其他域名的资源仍需各自授权才可 fetch，不会自动申请；fetch 不跟随重定向。目标网站可能收到 IP、请求地址及浏览器信息。Google 图标服务默认关闭；启用后可能通过图片请求向该服务发送网站域名，未授权时不会 fetch 读取。',
  },
  {
    title: '手动图片与其他远程资源',
    text: `${REMOTE_IMAGE_NOTICE} 已保存的远程图片在展示时也可能联网。图片请求设置不发送来源页面地址，但这不代表匿名请求，也不能保证目标站点不记录访问。`,
  },
  {
    title: '收藏标题补全',
    text: '新增收藏、输入网址且尚未手动编辑名称时，仅在已授权站点上尝试请求网页以补全标题。请求包含网址路径和查询参数，不包含片段；使用不携带凭据、不发送来源页面地址的 fetch 请求。目标网站仍可能收到 IP 及该完整请求地址，请避免输入含敏感令牌的网址。未授权时请手动填写名称。',
  },
  {
    title: '外部搜索与网页内容',
    text: '提交外部搜索时，搜索词及目标网址中的参数会交给你选择的搜索服务，例如 Google、Bing、百度或你配置的其他提供方。普通图标及手动图片的接收方是对应图片地址的站点及其可能重定向的服务；启用 Google 图标服务时，该服务会接收网站域名。打开收藏、外部链接或启用嵌入网页时，目标网站可能收到 IP、浏览器信息及其自身 Cookie。第三方按各自政策处理数据，开发者不能替其承诺保留期限或删除结果。当前扩展不提供匿名代理。自定义 HTTP 图片、搜索或网页地址可能使用未加密连接，请优先使用 HTTPS，不要把敏感内容写入网址或搜索词。',
  },
  {
    title: '数据用途与 Limited Use 承诺',
    text: '本扩展对用户数据的使用遵守 Chrome Web Store User Data Policy，包括 Limited Use 要求；在其他扩展商店发布时同样将数据使用限制在已披露的用户可见功能。不会出售用户数据，不用于个性化广告、广告画像、数据经纪或信用与借贷评估，不向开发者提供远程查看本地收藏或使用记录的接口。仅在提供你请求的功能所必需时向对应目标服务传递请求数据，不用于无关目的。不会仅因更新政策而把已有数据转作新的用途；涉及新的数据处理时先更新显著告知，并在需要时征求明确同意。',
  },
  {
    title: '保留期限与安全',
    text: '本地数据一般保留到你主动删除、清除扩展数据或卸载扩展。图标缓存可能按容量和过期策略被替换。移入回收站的数据仍保留在本地，直至彻底删除；你另行导出的文件不随卸载自动删除。数据依赖浏览器和操作系统的本地隔离保护，扩展没有为本地收藏、壁纸或导出文件额外提供应用级加密。请保护设备与浏览器账户，不要保存密码、访问令牌等秘密。已有权限允许的 fetch 使用 HTTPS，不携带凭据和来源页面地址；普通图片、外部搜索及网页访问仍遵循浏览器与目标站点的规则。',
  },
  {
    title: '导入、导出与删除',
    text: '手动导入文件在本地处理；导出文件可能包含私人网址和备注，未加密，请妥善保管。现有资产导出不包含全部设置和壁纸。可在应用中删除数据，或通过浏览器管理扩展数据；卸载、清除浏览器数据或切换扩展身份可能导致本地数据丢失。清除应用图标缓存后，显示图标时可能重新联网获取。',
  },
  {
    title: '告知记录与后续变更',
    text: '确认后只在本地记录本次告知版本，不发送确认记录。清除该记录或告知版本更新后会再次提示。可随时通过工作台的“隐私说明”入口重新查看；不希望继续使用时，可关闭页面，并在浏览器扩展管理页停用或移除本扩展。',
  },
  {
    title: '联系与隐私请求',
    text: '可通过本扩展商店条目中公布的开发者支持渠道联系发布者，咨询隐私、报告问题或提出数据请求。本地数据不在开发者服务器上，开发者不能远程读取、导出或删除你的浏览器数据；请使用扩展内管理功能或浏览器扩展管理功能操作。向支持渠道提交信息时，请勿附带完整私人收藏、密码或令牌；你主动提交的信息由该支持平台依其政策处理。',
  },
];

const privacySectionsEn = [
  {
    title: 'Scope and purpose',
    text: 'This policy applies to the JIGEQIU new tab extension, not to your browser vendor. The extension provides personal bookmarks, new tab shortcuts and search. Data needed for bookmark organization, local preferences, icons and search is used only for these user-facing features. Publisher identity and contact details are provided in the extension store listing.',
  },
  {
    title: 'Local data',
    text: 'Bookmark titles, URLs, notes, tags, folders, collections, search engine configurations, preferences, recent searches and in-app usage records you enter or import are stored in this extension\'s chrome.storage.local. Upgrades automatically migrate legacy LocalStorage data and verify the write before activating the new storage. Original data remains local but is no longer used for everyday reads and writes. Custom wallpapers and icon caches use local IndexedDB. In-app records support recent items, search and display; the extension does not read native browser history. There is no account cloud sync, upload of this local data to developer servers, advertising or third-party usage analytics tracking.',
  },
  {
    title: 'Browser permissions and new tabs',
    text: 'The extension replaces new tabs with the JIGEQIU workbench and requests storage permission for local data. It does not request favicon, native bookmarks, browsing history, tab management or default access to all sites, and does not inject content into other websites. The manifest declares optional HTTPS site permissions, but the extension currently neither requests them nor provides an authorization button. Existing site permissions can be revoked in browser extension settings. "Acknowledge and continue" only acknowledges this in-app notice; it does not grant website access.',
  },
  {
    title: 'Automatic site icons',
    text: 'Without site permission, icons and page metadata are not read using fetch; ordinary images or text fallbacks are used instead. Images may still connect to the network. With permission, the site\'s favicon, common icon files, homepage HTML and declared manifest, icons or logo may be read. Resources on other domains require their own permissions for fetch; these permissions are not requested automatically. Fetch does not follow redirects. Sites may receive your IP address, request URL and browser information. The Google icon service is off by default. Enabling it may send site domains to that service through image requests; fetch reads still require permission.',
  },
  {
    title: 'Manual images and other remote resources',
    text: `${extensionMessages.extensionRemoteImageNotice.en} Saved remote images may also connect to the network when displayed. Image requests are configured not to send the referring page URL. This does not make requests anonymous or guarantee that the destination will not log visits.`,
  },
  {
    title: 'Bookmark title completion',
    text: 'When adding a bookmark, entering a URL before manually editing its name may trigger a page request to complete its title, but only for a permitted site. The fetch request includes the path and query parameters, excludes the fragment, and omits credentials and the referring page URL. The destination may still receive your IP address and the full requested URL. Avoid URLs containing sensitive tokens. Without permission, enter the name manually.',
  },
  {
    title: 'External search and web content',
    text: 'Submitting an external search sends your query and destination URL parameters to your selected service, such as Google, Bing, Baidu or a custom provider. Ordinary icons and manual images contact their image sites and any services they redirect to. Enabling the Google icon service sends site domains to that service. Opening bookmarks, external links or embedded pages may send your IP address, browser information and the destination\'s own cookies to that site. Third parties handle data under their own policies; the developer cannot promise their retention periods or deletion results. There is no anonymous proxy. Custom HTTP image, search or page URLs may use unencrypted connections. Prefer HTTPS and keep sensitive information out of URLs and search queries.',
  },
  {
    title: 'Data use and Limited Use commitment',
    text: 'User data use follows the Chrome Web Store User Data Policy, including Limited Use requirements. Distribution through other stores likewise limits use to disclosed user-facing features. User data is not sold or used for personalized advertising, advertising profiles, data brokering, or credit and lending assessments. No interface lets the developer remotely view local bookmarks or usage records. Request data is sent to the relevant service only when needed for a feature you request, not for unrelated purposes. A policy update alone does not repurpose existing data. New processing will first be disclosed prominently, with explicit consent requested when required.',
  },
  {
    title: 'Retention and security',
    text: 'Local data generally remains until you delete it, clear extension data or uninstall the extension. Icon caches may be replaced according to capacity and expiration policies. Recycle bin items remain local until permanently deleted. Exported files are not automatically deleted on uninstall. Data relies on browser and operating system isolation; the extension adds no application-level encryption for bookmarks, wallpapers or exports. Protect your device and browser account, and do not store passwords, access tokens or other secrets. Permitted fetch requests use HTTPS and omit credentials and the referring page URL. Ordinary images, external searches and page visits still follow browser and destination rules.',
  },
  {
    title: 'Import, export and deletion',
    text: 'Manually imported files are processed locally. Exports may contain private URLs and notes and are not encrypted; keep them secure. Asset exports do not include all settings and wallpapers. You can delete data in the app or manage extension data in the browser. Uninstalling, clearing browser data or changing extension identity may cause local data loss. Clearing the icon cache may cause icons to be fetched from the network again when displayed.',
  },
  {
    title: 'Acknowledgment and future changes',
    text: 'Acknowledging stores only this notice version locally; no acknowledgment record is sent anywhere. Clearing that record or updating the notice version prompts you again. You can reopen it at any time through "Privacy notice" in the workbench. To stop using the extension, close the page and disable or remove it in browser extension settings.',
  },
  {
    title: 'Contact and privacy requests',
    text: 'Contact the publisher through developer support channels listed in the extension store for privacy questions, issue reports or data requests. Local data is not on developer servers. The developer cannot remotely read, export or delete your browser data; use the extension or browser data management controls. Do not send full private bookmark collections, passwords or tokens to support. Information you choose to submit is handled by that support platform under its own policy.',
  },
];

export function getPrivacySections(language?: string) {
  return selectLocale(language, []) === 'en' ? privacySectionsEn : privacySectionsZh;
}
