import type {DiscoveryContext,DiscoveryResponse} from "../src/domain/types";
import type {DataSearchPlan} from "./data-search";
import {windowFilters} from "../src/domain/time-window";

// Scope comes from the user-confirmed conversation, never from source coverage.
export function conversationScope(context:DiscoveryContext,plan?:DataSearchPlan):DiscoveryContext {
  if(context.attachedScope?.some(i=>i.kind==="time"))return {...context,filters:{...context.filters}};
  if(plan?.conversationPeriod===undefined && plan?.conversationWindow===undefined)return context;
  const filters={...context.filters};
  if(plan.conversationPeriod!==undefined){
    if(JSON.stringify(filters.period)!==JSON.stringify(plan.conversationPeriod))filters.utcWindow=null;
    filters.period=plan.conversationPeriod;
  }
  if(plan.conversationWindow)Object.assign(filters,windowFilters(plan.conversationWindow));
  else if(plan.conversationWindow===null)filters.utcWindow=null;
  return {...context,filters};
}

export function scopedReply(base:DiscoveryResponse,context:DiscoveryContext,plan?:DataSearchPlan):DiscoveryResponse {
  if(plan?.conversationPeriod===undefined && plan?.conversationWindow===undefined)return base;
  return {...base,filters:{...(base.filters || context.filters),period:context.filters.period,utcWindow:context.filters.utcWindow}};
}
