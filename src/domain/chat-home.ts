export const defaultHomeQuestions = [
  "研究西北太平洋2020—2023年的海表温度、叶绿素和海色变化，可以找到哪些卫星与其他资料？说明变量、版本和入口。",
  "想研究长白山地区2010—2023年的活动变化，需要气体、地震、形变与热异常哪些已有记录？请查找数据与论文用法。",
  "研究川西地区2020—2023年的地表形变，想找GNSS位移、InSAR产品和相关误差资料。有哪些已有数据与论文用法？",
  "为青藏高原东北缘做地质填图，需要哪些多光谱或高光谱影像、地质图、DEM和地面样品记录？",
  "研究大兴安岭2020—2023年的森林结构，想找树高、冠层覆盖度、LiDAR与样地资料，请说明变量和证据来源。",
];
export const maxHomeQuestions=20;
export const maxHomeQuestionLength=1000;
export interface ChatHomeConfig {questions:string[];revision:string}

export function parseHomeQuestions(value:unknown):string[]{
  if(!Array.isArray(value) || value.length>maxHomeQuestions)throw Error("首页最多配置 "+maxHomeQuestions+" 个问题。");
  const questions=value.map((text,i)=>{
    if(typeof text!=="string" || !text.trim())throw Error("请填写问题 "+(i+1)+"，或删除这一项。");
    if(text.trim().length>maxHomeQuestionLength)throw Error("问题 "+(i+1)+" 不能超过 "+maxHomeQuestionLength+" 字。");
    return text.trim();
  });
  if(new Set(questions).size!==questions.length)throw Error("问题有重复，请修改后再保存。");
  return questions;
}
export function parseChatHomeConfig(value:unknown):ChatHomeConfig{
  const config=value as Partial<ChatHomeConfig>|null;
  if(!config || typeof config.revision!=="string" || !/^[a-f0-9]{64}$/.test(config.revision))throw Error("首页问题配置格式无效。");
  return {questions:parseHomeQuestions(config.questions),revision:config.revision};
}
