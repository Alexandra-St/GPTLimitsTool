const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, 'Main.swift'), 'utf8');
const model = fs.readFileSync(path.join(__dirname, 'CycleModel.swift'), 'utf8');
const prep = main.slice(main.indexOf('func acquireBackgroundRenderSurface(owner:String,waitForConversationLinks:Bool)'), main.indexOf('func evaluateRenderReadiness(owner:String,timeoutSeconds:Double)'));
const diagnostics = main.slice(main.indexOf('func updateRuntimeIdentity()'), main.indexOf('func manualDiagnosticOwnerLabel()'));

test('every render readiness completion persists a sanitized diagnostic into the production cycle state', () => {
  assert.match(prep, /recordRenderReadiness\(phase:preflight\["stage"\][\s\S]*result:readinessSuccess/);
  assert.match(prep, /catch \{[\s\S]*recordRenderReadiness\(phase:"readiness",result:\.failure,reason:renderReadinessFailureCode\(error\)\)/);
  assert.match(prep, /recordRenderReadiness\(phase:"route",result:\.failure,reason:"unexpected_page"\)/);
  assert.match(main, /cycleState\.recordRenderReadiness\([\s\S]*saveCycle\(\)/);
  assert.match(main, /func recordRenderReadinessNavigationFailure\([\s\S]*reason=nsError\.domain==NSURLErrorDomain \? "navigation_failed":"navigation_error"/);
  assert.equal((main.match(/recordRenderReadinessNavigationFailure\(error\)/g) || []).length, 2);
  assert.match(model, /var lastRenderReadiness:RenderReadinessDiagnostic\? = nil/);
});

test('Diagnostics renders the persisted production cycle state and exposes only safe route categories', () => {
  assert.match(diagnostics, /cycleState\.lastRenderReadiness\.map\(renderReadinessDiagnosticSummary\)/);
  assert.match(diagnostics, /Last render readiness:/);
  assert.match(model, /enum RenderReadinessRouteCategory:String,Codable \{case chat,home,loginAuth="login\/auth",other\}/);
  assert.match(model, /func renderReadinessRouteCategory\(_ url:URL\?\)/);
  assert.match(model, /sanitizedRenderReadinessCode/);
  assert.doesNotMatch(model, /var lastRenderReadiness[^\n]*(URL|cookie|token|chatID)/i);
});

test('successful readiness replaces an earlier failure without changing readiness decisions', () => {
  assert.match(model, /mutating func recordRenderReadiness\([\s\S]*lastRenderReadiness=RenderReadinessDiagnostic/);
  assert.match(prep, /let readinessSuccess=ready && links>0/);
  assert.match(prep, /reason:readinessReason/);
  const record = model.slice(model.indexOf('mutating func recordRenderReadiness('), model.indexOf('\n }', model.indexOf('mutating func recordRenderReadiness(')));
  assert.doesNotMatch(record, /records|lowerBound|lastNotifiedRiskRank|notification/i);
});

test('readiness diagnostics use the current cycle domain and never serialize URL or cookie material', () => {
  assert.match(model, /var lastRenderReadiness:RenderReadinessDiagnostic\? = nil/);
  assert.match(model, /func renderReadinessRouteCategory\(_ url:URL\?\)/);
  assert.match(model, /enum RenderReadinessRouteCategory:String,Codable/);
  assert.match(main, /cycleState\.recordRenderReadiness\([\s\S]*routeCategory:renderReadinessRouteCategory\(web\.url\)\)/);
  assert.doesNotMatch(main, /lastRenderReadiness[\s\S]{0,300}(absoluteString|query|cookie|token|conversationId)/i);
});
