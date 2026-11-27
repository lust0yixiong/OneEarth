import {useEffect, useState} from "react";
import {Search} from "lucide-react";
import {readDeepSeekTools, saveDeepSeekTools, validDeepSeekTools, type DeepSeekTools} from "../domain/deepseek-tools";

export function DeepSeekToolsSettings() {
  const [tools, setTools] = useState(readDeepSeekTools);
  const [hasKey, setHasKey] = useState<boolean>();
  const [deploymentTools,setDeploymentTools]=useState<DeepSeekTools>();
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/models/deepseek/tools", {signal: controller.signal, cache: "no-store"})
      .then(async response => {
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!controller.signal.aborted) {
          setHasKey(data.configured === true);
          if (validDeepSeekTools(data.defaults)) {
            setDeploymentTools(data.defaults);
            setTools(readDeepSeekTools(data.defaults));
          }
        }
      }).catch(() => { if (!controller.signal.aborted) setError("无法读取服务端密钥状态。"); });
    return () => controller.abort();
  }, []);

  function toggle(name: keyof DeepSeekTools, checked: boolean) {
    const next = {...tools, [name]: checked};
    try {
      saveDeepSeekTools(next);
      setTools(next);
      setError("");
    } catch { setError("浏览器未能保存工具设置。"); }
  }

  return <section aria-labelledby="deepseek-tools-heading">
    <h2 id="deepseek-tools-heading"><Search size={19}/>DeepSeek 网页工具</h2>
    <label>Search · 补充搜索公开网页<input type="checkbox" checked={tools.search} onChange={e => toggle("search", e.target.checked)}/></label>
    <label>Fetch · 读取候选来源正文<input type="checkbox" checked={tools.fetch} onChange={e => toggle("fetch", e.target.checked)}/></label>
    <small>开关保存到当前浏览器。执行时还需部署授权及运行时密钥，工具按调用计费。</small>
    {hasKey === false && <small role="status">运行时尚缺 DeepSeek 密钥，由部署端配置 DEEPSEEK_API_KEY。</small>}
    {hasKey === true && deploymentTools && <small role="status">
      运行时密钥已配置。部署授权：Search {deploymentTools.search?"已启用":"未启用"}，Fetch {deploymentTools.fetch?"已启用":"未启用"}。
    </small>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
