import test from 'node:test';
import assert from 'node:assert/strict';
import { sameAtlasData } from '../dist/atlas-equality.js';
import { createAccessState, createVaultState, createJourneyState, validateAtlasSnapshot } from '../dist/index.js';

test('structural equality preserves every validated authority field and ordered list', () => {
  const configuration={accessTiming:{waitMs:10,confirmationWindowMs:100,grantDurationMs:200},vaultTiming:{waitMs:20,confirmationWindowMs:100},journeyLimits:{lifetimeMs:200,maxHops:12}};
  const original=validateAtlasSnapshot({policy:{whitelist:['a.example','b.example'],blacklist:['blocked.example'],whitelistSubdomains:['scope.example']},
    policyRevision:1,configuration,configurationRevision:1,accessState:createAccessState(),vaultState:createVaultState(),journeyState:createJourneyState()}).snapshot;
  assert.ok(original); assert.ok(sameAtlasData(original, original)); assert.ok(sameAtlasData(original, structuredClone(original)));
  const mutations=[s=>s.policy.whitelist.reverse(),s=>s.policy.blacklist.push('other.example'),s=>s.policy.whitelistSubdomains.pop(),
    s=>s.policyRevision++,s=>s.configurationRevision++,s=>s.configuration.accessTiming.waitMs++,
    s=>s.accessState.lastObservedAt++,s=>s.accessState.nextRequestId++,s=>s.vaultState.nextProposalId++,s=>s.journeyState.nextJourneyId++];
  for(const mutate of mutations){const next=structuredClone(original);mutate(next);assert.equal(sameAtlasData(original,next),JSON.stringify(original)===JSON.stringify(next));assert.equal(sameAtlasData(original,next),false);}
});

test('shared immutable history and copied history compare without omitting deep changes', () => {
  const original=Object.freeze(Array.from({length:2500},(_,id)=>Object.freeze({id,context:'history_'+id,deadline:100,hosts:Object.freeze(['root.example'])})));
  const next=structuredClone(original);assert.ok(sameAtlasData(original,next));
  next[2499].deadline++;assert.equal(sameAtlasData(original,next),false);
  assert.equal(sameAtlasData({records:original},{records:original}),true);
  assert.equal(sameAtlasData({a:null},{a:[]}),false);
  assert.equal(sameAtlasData({a:1},{b:1}),false);
});
