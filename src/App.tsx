import { useState, useEffect, lazy, Suspense } from "react";
import { SettingsPage } from "./components/SettingsPage";
import { useDataAccessNavigation } from "./components/use-data-access-navigation";
import { ArrowLeft, Globe, Rows3, BookOpen, Settings, X, Info } from "lucide-react";
import { useWorkspace, WorkspaceProvider } from "./domain/store";
const GlobeView = lazy(() =>
  import("./components/GlobeView").then((m) => ({ default: m.GlobeView })),
);
const DiscoverView = lazy(() =>
  import("./components/DiscoverView").then((m) => ({
    default: m.DiscoverView,
  })),
);
const CasesView = lazy(() =>
  import("./components/CasesView").then((m) => ({ default: m.CasesView })),
);

import { ChatBoundary, useChatLayout } from "./components/ChatBoundary";
import { ChatPanel } from "./components/ChatPanel";
import { DatasetInspector } from "./components/DatasetInspector";
import { DataInspector } from "./components/DataInspector";
import { EvidenceReader } from "./components/EvidenceReader";
import { SourcePreviewProvider } from "./components/SourcePreviewHost";

import type { View } from "./domain/types";
const promoHome = new URL(`http://${location.hostname}:5176/`);
const fromPromo = Boolean(document.referrer) && new URL(document.referrer).origin === promoHome.origin;

const nav: { id: View; label: string; icon: typeof Globe }[] = [
  { id: "earth", label: "数据地球", icon: Globe },
  { id: "discover", label: "数据触达", icon: Rows3 },
  { id: "cases", label: "案例", icon: BookOpen },
];
function Workspace() {
  const { state: s, resultLink, patch, openCatalog, openEarth, openMappedCatalog } = useWorkspace();
  const [dataAccessNavigation] = useDataAccessNavigation();
  const [about, setAbout] = useState(false);
  const [mapToolsHost, setMapToolsHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!mapToolsHost) return;
    const app = mapToolsHost.closest<HTMLElement>(".app");
    const resize = new ResizeObserver(() => {
      app?.style.setProperty("--map-tools-height", mapToolsHost.offsetHeight + "px");
    });
    resize.observe(mapToolsHost);
    return () => { resize.disconnect(); app?.style.removeProperty("--map-tools-height"); };
  }, [mapToolsHost]);
  const chatLayout = useChatLayout(s.chatOpen);
  const [settings,setSettings] = useState(location.hash === "#/settings");
  useEffect(()=>{
    const update=()=>setSettings(location.hash === "#/settings");
    window.addEventListener("hashchange",update);
    return ()=>window.removeEventListener("hashchange",update);
  },[]);
  const openSettings=()=>{
    history.pushState({...history.state,fromWorkspace:true},"","#/settings");
    setSettings(true);
  };
  const closeSettings=()=>{
    if (history.state?.fromWorkspace) history.back();
    else {history.replaceState(history.state,"",location.pathname+location.search);setSettings(false);}
  };
  if (s.linkStatus) return (
    <main className="loading-surface" role={s.linkStatus === "failed" ? "alert" : "status"}>
      {s.linkStatus === "loading" ? "正在载入这批结果…" : <section>
        <h1>无法打开这批结果</h1><p>{s.error}</p>
        <button onClick={() => location.reload()}>重试读取</button>
        <button onClick={() => { patch({linkStatus:null, error:null}); openCatalog(); }}>浏览全部资料</button>
      </section>}
    </main>
  );
  return (<SourcePreviewProvider frame={s.chatOpen?chatLayout.frame:null}>
    {settings && <SettingsPage onBack={closeSettings} resetLayout={chatLayout.reset}/>}
    <div inert={settings} aria-hidden={settings || undefined}
      className={[
        "app",
        !s.chatOpen && "chat-collapsed",
        chatLayout.resizing && "chat-resizing",
        chatLayout.moving && "chat-moving",
        s.evidence && (s.inspector || s.dataView) && "preview-with-data",
      ]
        .filter(Boolean)
        .join(" ")}
      style={chatLayout.style}
    >
      <header className="app-header">
        <button
          className="wordmark"
          onClick={openEarth}
          aria-label="OneEarth 首页"
        >
          <img
            src="/brand/OneEarth-lockup-light-transparent@1x.png"
            alt="OneEarth"
            width="704"
            height="244"
          />
        </button>
        <span className="workspace-name">让地球可被理解和计算</span>
        <div className="header-actions">
          {resultLink.notice && <small role="status">{resultLink.notice}
            {!resultLink.notice.startsWith("正在") && <button onClick={resultLink.retry}>重试保存链接</button>}
          </small>}
          {fromPromo && <a className="promo-home-link" href={promoHome.href}>
            <ArrowLeft size={14} aria-hidden="true" />
            返回主页
          </a>}
          <button className="build-info" onClick={() => setAbout(!about)}>
            <span />
            关于 OneEarth
            <Info size={13} />
          </button>
        </div>
      </header>
      <nav className="app-nav" aria-label="主导航">
        {nav.filter(({ id }) => id !== "discover" || dataAccessNavigation).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-label={label}
            title={label}
            className={s.view === id ? "active" : ""}
            aria-current={s.view === id ? "page" : undefined}
            onClick={() =>
              id === "discover"
                ? openMappedCatalog()
                : id === "earth"
                  ? openEarth()
                  : patch({ view: id, evidence: null })
            }
          >
            <Icon size={21} strokeWidth={1.6} />
            <span>{label}</span>
          </button>
        ))}
        <div className="nav-bottom">
          <button className="model-settings-trigger" title="设置" aria-label="设置" onClick={openSettings}><Settings size={19}/></button>
        </div>
      </nav>
      <main className="main-workspace">
        <div className="main-surface">
          <Suspense
            fallback={<div className="loading-surface">正在载入空间数据…</div>}
          >
            {s.view === "discover" ? (
              <DiscoverView />
            ) : s.view === "cases" ? (
              <CasesView />
            ) : (
              <GlobeView rightInset={chatLayout.mapInset} toolsHost={mapToolsHost} />
            )}
          </Suspense>
        </div>
        {s.inspector ? (
          <DatasetInspector
            key={
              "assetId" in s.inspector
                ? s.inspector.assetId
                : "batch" in s.inspector
                  ? s.inspector.batch.title
                  : "comparison"
            }
          />
        ) : (
          s.view === "earth" && <DataInspector />
        )}
        {s.view === "earth" && (s.inspector || s.dataView) && <div className="map-tools-dock" ref={setMapToolsHost} />}
      </main>
      <ChatPanel layout={chatLayout} />
      <EvidenceReader />
      <ChatBoundary
        open={s.chatOpen}
        onToggle={() => patch({ chatOpen: !s.chatOpen })}
        layout={chatLayout}
      />
      {s.error && (
        <div className="error-notice" role="alert">
          <Info size={16} />
          <span>{s.error}</span>
          <button onClick={() => patch({ error: null })} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
      {about && (
        <div className="about-popover">
          <button onClick={() => setAbout(false)} aria-label="关闭版本说明">
            <X size={14} />
          </button>
          <header className="about-heading">
            <img
              className="about-brand"
              src="/brand/OneEarth-lockup-light-transparent@1x.png"
              alt="OneEarth"
            />
            <h2>地球科学国际科技公共产品</h2>
          </header>
          <div className="about-story">
            <p>人工或传统流程难以快速发现<span><strong>行星规模</strong>、</span><strong>长时间尺度</strong>数据中的关系与模式。</p>
            <p>OneEarth 持续推动多源开放数据的时空对齐与关联，并为异构数据构建统一表征。</p>
          </div>
          <p className="about-goal"><span>目标：</span><strong>让地球可被理解和计算。</strong></p>
          <p className="about-release">
            当前版本 v0.1 · <span>评测报告（待发布）</span>
          </p>
        </div>
      )}
    </div>
  </SourcePreviewProvider>);
}
export default function App() {
  return (
    <WorkspaceProvider>
      <Workspace />
    </WorkspaceProvider>
  );
}
