import { ArrowLeft, Check, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { PRIVACY_VERSION } from './content';
import { PrivacyContent, PrivacyDialog } from './PrivacyDialog';
import './privacy.css';

export function PrivacyPage({
  initial = false,
  onContinue,
}: {
  initial?: boolean;
  onContinue?: () => void | Promise<void>;
}) {
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <main className="extension-privacy-page">
      <header>
        <img src="brand/logo-a2-equator.png" width="48" height="48" alt="" />
        <div>
          <h1>记个球</h1>
          <p>浏览器新标签页扩展</p>
        </div>
      </header>
      <h2>{initial ? '使用前的隐私告知' : '隐私说明'}</h2>
      <p className="privacy-version">告知版本：{PRIVACY_VERSION}</p>
      {initial ? (
        <>
          <ul className="privacy-summary">
            <li>收藏、设置及壁纸保存在当前浏览器，不提供云同步。</li>
            <li>
              扩展替换浏览器新标签页；未授权网站使用普通图片加载，不主动申请网站访问权限。
            </li>
            <li>
              远程图片、外部搜索、收藏链接及嵌入网页可能连接第三方网站，对方可能收到
              IP、搜索词或浏览器请求信息。
            </li>
            <li>
              图标可能自动连接图片站点；提交搜索时会向所选服务发送搜索词。已有站点权限下的标题补全可能请求包含路径和查询参数的完整网址。
            </li>
          </ul>
          <p>
            这是应用内隐私告知，不会代替浏览器的权限授权。未确认前不会进入工作台。
          </p>
          <button type="button" onClick={() => setDetails(true)}>
            完整隐私说明
          </button>
          {declined ? (
            <div className="privacy-declined">
              <p role="status">
                尚未进入工作台。你可以关闭本页，并在浏览器扩展管理页停用或移除记个球。
              </p>
              <button type="button" onClick={() => setDeclined(false)}>
                <ArrowLeft size={16} />
                返回隐私告知
              </button>
            </div>
          ) : (
            <div className="privacy-actions">
              <button type="button" onClick={() => setDeclined(true)}>
                暂不使用
              </button>
              <button
                type="button"
                className="privacy-primary"
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  setError('');
                  try {
                    await onContinue?.();
                  } catch {
                    setError(
                      '无法保存本地告知记录，未进入工作台。请检查浏览器存储权限后重试。',
                    );
                  } finally { setBusy(false); }
                }}
              >
                <Check size={16} />
                知晓并继续
              </button>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      ) : (
        <>
          <PrivacyContent />
          <a className="privacy-return" href={`./index.html${location.hash}`}>
            <ArrowLeft size={16} />
            返回
          </a>
        </>
      )}
      <footer>
        <ShieldCheck size={16} />
        隐私说明随扩展提供，可离线查看。
      </footer>
      {details && <PrivacyDialog onClose={() => setDetails(false)} />}
    </main>
  );
}
