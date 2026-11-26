import {EventSchema} from "@ag-ui/core/schemas";
import {nativeChatSubmission} from "./read-native-chat.mjs";

export function nativeChatFixture(route, {response,error}) {
  const {runId,threadId}=nativeChatSubmission(route.request());
  const events = [{type:"RUN_STARTED",runId,threadId,protocolVersion:"1.0"}];
  if(error)events.push({type:"RUN_ERROR",...error});
  else {
    events.push({type:"TEXT_MESSAGE_START",messageId:runId,role:"assistant"});
    if(response.message)events.push({type:"TEXT_MESSAGE_CONTENT",messageId:runId,delta:response.message});
    events.push({type:"TEXT_MESSAGE_END",messageId:runId},
      {type:"RUN_FINISHED",runId,threadId,result:{oneearth:{version:1,messageId:runId,response}}});
  }
  return route.fulfill({status:200,contentType:"text/event-stream",
    body:events.map(event=>"data: "+JSON.stringify(EventSchema.parse(event))+"\n\n").join("")});
}
