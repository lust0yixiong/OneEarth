import {useEffect, useState} from "react";
import {Search} from "lucide-react";
import {readDeepSeekTools, saveDeepSeekTools, validDeepSeekTools, type DeepSeekTools} from "../domain/deepseek-tools";

export function DeepSeekToolsSettings({keyRevision}: {keyRevision: number}) {
  const [tools, setTools] = useState(readDeepSeekTools);
  const [hasKey, setHasKey] = useState<boolean>();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/models/deepseek/tools", {signal: controller.signal, cache: "no-store"})
      .then(async response => {
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!controller.signal.aborted) {
          setHasKey(data.configured === true);
          if (validDeepSeekTools(data.defaults)) setTools(readDeepSeekTools(data.defaults));
        }
      }).catch(() => { if (!controller.signal.aborted) setError("无法读取服务端密钥状态。"); });
    return () => controller.abort();
  }, [keyRevision]);

  function toggle(name: keyof DeepSeekTools, checked: boolean) {
    const next = {...tools, [name]: checked};
    try {
      saveDeepSeekTools(next);
      setTools(next);
      setError("");
    } catch { setError("浏览器未能保存工具设置。"); }
  }

  async function applyKey() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/models/service/key", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({config: {executor: "codex", provider: "deepseek", model: ""}, key: key.trim()}),
      });
      if (!response.ok) throw Error("密钥保存失败，请重试。");
      setKey("");
      setHasKey(true);
    } catch (err) { setError(err instanceof Error ? err.message : "密钥保存失败。"); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="deepseek-tools-heading">
    <h2 id="deepseek-tools-heading"><Search size={19}/>DeepSeek 网页工具</h2>
    <label>Search · 补充搜索公开网页<input type="checkbox" checked={tools.search} onChange={e => toggle("search", e.target.checked)}/></label>
    <label>Fetch · 读取候选来源正文<input type="checkbox" checked={tools.fetch} onChange={e => toggle("fetch", e.target.checked)}/></label>
    <small>开关自动保存到当前浏览器，下次提问生效。工具按调用计费。</small>
    {(tools.search || tools.fetch) && hasKey === false && <div>
      <label>DeepSeek API Key<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)}/></label>
      <button type="button" disabled={!key.trim() || busy} onClick={applyKey}>应用工具密钥</button>
      <small>密钥供当前部署使用，重启后需重新填写。也可在服务端配置 DEEPSEEK_API_KEY。</small>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
