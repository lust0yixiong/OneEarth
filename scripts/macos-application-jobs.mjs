import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,renameSync,statSync,unlinkSync,writeFileSync} from "node:fs";
import {setTimeout as wait} from "node:timers/promises";
import path from "node:path";

export function macosApplicationJobs(directory, domain) {
  const file = label => path.join(directory, label + ".plist");
  const launch = args => execFileSync("/bin/launchctl", args, {encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  const controlled = label => domain + "/" + label;

  function registered(label) {
    try { return launch(["print",controlled(label)]); }
    catch { return ""; }
  }
  function inspect(label) {
    const status = registered(label);
    const read = key => status.match(new RegExp("^\\s*" + key + " = (.+)$","m"))?.[1];
    return {label,registered:!!status,state:read("state"),pid:Number(read("pid")) || undefined};
  }
  function snapshot(labels) {
    return labels.map(label => {
      const name = file(label);
      if (!existsSync(name)) {
        if (registered(label)) throw Error("已注册启动项缺少可恢复配置：" + label);
        return {label,registered:false};
      }
      const stat = statSync(name);
      if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
        throw Error("OneEarth 启动项须仅当前用户可访问：" + label);
      return {label,registered:!!registered(label),content:readFileSync(name)};
    });
  }
  function processTree(root) {
    const listing = execFileSync("/bin/ps",["-axww","-o","pid=","-o","ppid=","-o","command="],{encoding:"utf8"});
    const processList = listing.trim().split("\n").flatMap(line => {
      const entry = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      return entry ? [{pid:Number(entry[1]),parent:Number(entry[2]),command:entry[3]}] : [];
    });
    const pids = new Set([root]);
    let count = 0;
    while (count !== pids.size) {
      count = pids.size;
      for (const entry of processList) if (pids.has(entry.parent)) pids.add(entry.pid);
    }
    return processList.filter(entry => pids.has(entry.pid));
  }
  function remains({pid,command}) {
    try {
      return execFileSync("/bin/ps",["-ww","-p",String(pid),"-o","command="],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim() === command;
    } catch (error) {
      if (error.status !== 1) throw error;
      return false;
    }
  }
  async function stop(labels) {
    const processes = [];
    for (const label of labels) {
      const status = inspect(label);
      if (!status.registered) continue;
      if (status.pid) processes.push(...processTree(status.pid));
      launch(["bootout",controlled(label)]);
    }
    for (let attempt = 0; attempt < 110; ++attempt) {
      if (!labels.some(registered) && !processes.some(remains)) return;
      await wait(200);
    }
    throw Error("OneEarth 旧进程未退出，停止切换。");
  }
  async function boot(label) {
    if (registered(label)) return;
    for (let attempt = 0;; ++attempt) {
      try { launch(["bootstrap",domain,file(label)]); return; }
      catch (error) {
        if (registered(label)) return;
        if (attempt >= 6 || error.status !== 5) throw error;
        await wait(350);
      }
    }
  }
  function staged(label, content, suffix) {
    const temp = file(label) + "." + suffix + "-" + process.pid;
    writeFileSync(temp,content,{mode:0o600,flag:"wx"});
    try { execFileSync("/usr/bin/plutil",["-lint",temp],{stdio:"ignore"}); }
    catch (error) { unlinkSync(temp); throw error; }
    return temp;
  }
  function place(label, content) {
    const temp = staged(label,content,"restoring");
    try { renameSync(temp,file(label)); }
    finally { if (existsSync(temp)) unlinkSync(temp); }
  }
  async function install({jobs,stopOrder,quiescent,beforeBoot,beforeRestore,verify,verifyRestored}) {
    const previous = snapshot(stopOrder);
    const prepared = [];
    let replacing = false;
    try {
      for (const job of jobs) prepared.push({...job,temp:staged(job.label,job.content,"installing")});
      try {
        await stop(stopOrder);
        await quiescent();
        await beforeBoot?.();
        for (const job of prepared) renameSync(job.temp,file(job.label));
        replacing = true;
        for (const job of prepared) await boot(job.label);
        await verify();
        for (const old of previous) {
          if (!jobs.some(job => job.label === old.label) && existsSync(file(old.label))) unlinkSync(file(old.label));
        }
      } catch (failure) {
        try {
          await stop(stopOrder);
          await quiescent();
          if (replacing) await beforeRestore?.();
          for (const old of previous) {
            if (old.content) place(old.label,old.content);
            else if (existsSync(file(old.label))) unlinkSync(file(old.label));
          }
          for (const old of previous.slice().reverse()) if (old.registered) await boot(old.label);
          await verifyRestored?.(previous);
        } catch (restoreFailure) {
          throw new AggregateError([failure,restoreFailure],"OneEarth 启动失败，自动回退未完成。");
        }
        throw failure;
      }
    } finally {
      for (const {temp} of prepared) if (existsSync(temp)) unlinkSync(temp);
    }
  }

  return {file,inspect,registered,stop,boot,install,snapshot};
}
