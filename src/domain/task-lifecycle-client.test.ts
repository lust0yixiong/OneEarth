import assert from "node:assert/strict";
import test from "node:test";
import {mergeTaskLifecycle,readTaskLifecycle} from "./task-lifecycle-client";
import {mergeMessages} from "./session-storage";
import type {Message} from "./types";

test("late remote facts apply only to matching canceled messages and cannot downgrade a confirmed stop",()=>{
  const cancelled:Message={id:"task1",role:"assistant",replyTo:"turn1",text:"本地任务已取消。",time:1,
    taskLifecycle:{runtimePhase:{phase:"cancelled"},remoteStops:[{discoveryTaskId:"a",state:"pending"}]}};
  const [changed]=mergeMessages([cancelled],[{...cancelled,text:"inadmissible replacement",
    taskLifecycle:{runtimePhase:{phase:"cancelled"},remoteStops:[{discoveryTaskId:"a",state:"confirmed"},{discoveryTaskId:"b",state:"unconfirmed"}]}}]);
  assert.equal(changed.text,cancelled.text);
  assert.equal(changed.taskLifecycle?.runtimePhase?.phase,"cancelled");
  assert.deepEqual(changed.taskLifecycle?.remoteStops,[{discoveryTaskId:"a",state:"confirmed"},{discoveryTaskId:"b",state:"unconfirmed"}]);
  assert.equal(mergeMessages([changed],[cancelled])[0],changed);
  assert.equal(mergeMessages([changed],[{...cancelled,replyTo:"foreign-turn"}])[0],changed);
  assert.equal(mergeTaskLifecycle(changed.taskLifecycle,{runtimePhase:{phase:"resuming"}}),changed.taskLifecycle);
});

test("the read-side parser prefers a complete remote stop list to its summary and ignores malformed facts",()=>{
  assert.equal(readTaskLifecycle({runtimePhase:{phase:"invented"},remoteStop:{discoveryTaskId:"a",state:"success"}}),undefined);
  assert.deepEqual(readTaskLifecycle({
    runtimePhase:{phase:"waiting-discovery",operation:"unknown"},
    remoteStop:{discoveryTaskId:"a",state:"confirmed"},
    remoteStops:[{discoveryTaskId:"a",state:"confirmed"},{discoveryTaskId:"b",state:"pending"}],
  }),{runtimePhase:{phase:"waiting-discovery"},remoteStops:[{discoveryTaskId:"a",state:"confirmed"},{discoveryTaskId:"b",state:"pending"}]});
});
