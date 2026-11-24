import {mkdir,writeFile,readdir} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {providerCliInstructions} from "./provider-cli-request";

/** Child-only Flash profile: no user rules, skill text, project or MCP config. */
export async function isolateProviderCli(dir:string,args:string[],env:NodeJS.ProcessEnv){
 const profile=path.join(dir,"provider-profile"),instructions=path.join(dir,"provider-instructions.md");
 await mkdir(profile);
 await writeFile(instructions,providerCliInstructions+"\n",{mode:0o600});
 const skillRoot=path.join(os.homedir(),".agents","skills");
 let names:string[]=[];try{names=(await readdir(skillRoot,{withFileTypes:true})).filter(item=>item.isDirectory()).map(item=>item.name).slice(0,512);}catch{/* No host skills is the normal isolated case. */}
 const disabled="skills.config=["+names.map(name=>"{path="+JSON.stringify(path.join(skillRoot,name,"SKILL.md"))+",enabled=false}").join(",")+"]";
 args.push("--disable","apps","--disable","goals","--enable","skip_host_skill_discovery","--ignore-rules",
  "--disable","skill_search","--disable","skill_mcp_dependency_install","-c",disabled,"-c","model_instructions_file="+JSON.stringify(instructions),
  "-c","project_doc_max_bytes=0","-c",'web_search="disabled"');
 env.CODEX_HOME=profile;
}
