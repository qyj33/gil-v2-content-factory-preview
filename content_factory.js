const state = {
  candidates: [],
  productionsByCandidate: {},
  selectedId: null,
  ranking: null,
};

const scoreDimensions = [
  ["freshness", "信息时效"],
  ["authority", "来源权威"],
  ["applicant_value", "申请者价值"],
  ["decision_value", "决策价值"],
  ["business_value", "业务价值"],
  ["persona_match", "画像匹配"],
  ["knowledge_value", "知识价值"],
];
const sourceTypeLabels = {
  PROGRAM_INTELLIGENCE: "Program Intelligence",
  STRATEGY_INTELLIGENCE: "Strategy Intelligence",
};
const batchStatusLabels = {
  CONTENT_REVIEW: "正文生成阻塞",
  HANDOFF_CREATED: "交接已创建",
  VISUAL_REVIEW: "视觉 QA 阻塞",
  DELIVERY_REVIEW: "交接阻塞",
};
const selectionReasonLabels = {
  BELOW_QUALITY_THRESHOLD: "低于质量阈值",
  OUTSIDE_TARGET_CAPACITY: "达到质量线，但超出本批次 Target",
};
const nextActionLabels = {
  GENERATE_CONTENT: "下一步：生成证据约束正文",
  RENDER_VISUALS: "下一步：生成视觉页面",
  REVIEW_VISUAL_QA: "下一步：复核未通过的视觉规则",
  CREATE_DELIVERY: "下一步：创建 Atlas 交接清单",
  RETRY_DELIVERY: "下一步：检查并重试交接",
  REVIEW_ATLAS_HANDOFF: "下一步：人工检查 Atlas 交接成品",
};

const healthMetricLabels = [
  ["qualified", "达标"],
  ["selected", "入选窗口"],
  ["frozen", "已冻结"],
  ["producing", "生产中"],
  ["ready", "待发布"],
  ["published", "已发布"],
  ["review", "待复核"],
  ["failed", "失败"],
  ["learning_pending", "学习待治理"],
  ["completed_cleanups", "清理完成"],
];
const stageStateLabels = {
  WAITING: "等待输入",
  READY: "已就绪",
  FROZEN: "批次已冻结",
  QA_PASSED: "视觉 QA 已通过",
  REVIEW_REQUIRED: "需要复核",
  PUBLISHED: "已确认发布",
  ACTIVE: "规则生效",
  COMPLETED: "清理完成",
};

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

async function request(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.dataset.error = error ? "true" : "false";
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 3600);
}

function score(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function statusFor(candidate) {
  const production = state.productionsByCandidate[candidate.id] || {};
  const statuses = {
    HANDOFF_CREATED: { label: "Atlas 交接已创建", tone: "ready" },
    DELIVERY_REVIEW: { label: "交接需要复核", tone: "review" },
    VISUAL_QA_PASSED: { label: "视觉 QA 已通过", tone: "verified" },
    VISUAL_REVIEW: { label: "视觉需要复核", tone: "review" },
    CONTENT_GENERATED: { label: "正文已生成", tone: "working" },
    CANDIDATE_READY: { label: "候选已就绪", tone: "queued" },
  };
  if (production.production_status && statuses[production.production_status]) {
    return { ...statuses[production.production_status], ...production };
  }
  const delivery = production.delivery_package;
  if (delivery?.delivery_status === "HANDOFF_CREATED") {
    return { label: "Atlas 交接已创建", tone: "ready", ...production };
  }
  if (production.visual_render_output?.qa_result?.status === "PASS") {
    return { label: "视觉 QA 已通过", tone: "verified", ...production };
  }
  if (production.visual_render_output) {
    return { label: "视觉需要复核", tone: "review", ...production };
  }
  if (production.content_package) {
    return { label: "正文已生成", tone: "working", ...production };
  }
  return { label: "候选已就绪", tone: "queued", ...production };
}

function workflowExplanation(production) {
  const action = production.next_action;
  if (action === "REVIEW_VISUAL_QA") {
    const failedRules = (production.visual_render_output?.qa_result?.rules || [])
      .filter((item) => !item.passed);
    const diagnostics = failedRules
      .map((item) => item.diagnostic || item.name)
      .filter(Boolean)
      .slice(0, 2);
    return {
      text: `阻塞：视觉 QA 未通过${diagnostics.length ? `；${diagnostics.join("；")}` : "，等待具体诊断"}`,
      blocked: true,
    };
  }
  if (action === "RETRY_DELIVERY") {
    return {
      text: "阻塞：Atlas 交接未成功，等待交接任务检查并重试。",
      blocked: true,
    };
  }
  return {
    text: nextActionLabels[action] || "下一步将由 Task Engine 决定",
    blocked: false,
  };
}

function renderCandidates() {
  const target = $("#candidateList");
  const ranked = [...state.candidates].sort(
    (a, b) => Number(b.final_score || 0) - Number(a.final_score || 0),
  );
  $("#poolDescription").textContent = ranked.length
    ? `当前 ${ranked.length} 条候选，按最终分从高到低排序；全部引用已验证项目知识。`
    : "暂无候选。官网项目完成验证后，系统会自动进入候选与生产链路。";
  target.innerHTML = ranked.length ? ranked.map((candidate, index) => {
    const production = statusFor(candidate);
    return `<button class="candidate-row ${state.selectedId === candidate.id ? "selected" : ""}" data-id="${esc(candidate.id)}" type="button">
      <span class="rank">${index + 1}</span>
      <span class="candidate-copy"><strong>${esc(candidate.topic)}</strong><small>${esc(sourceTypeLabels[candidate.candidate_type] || candidate.candidate_type || "内容候选")} · ${esc(candidate.recommended_angle || "等待推荐角度")}</small></span>
      <span class="candidate-side"><b>${score(candidate.final_score)}</b><em class="tag ${production.tone}">${esc(production.label)}</em></span>
    </button>`;
  }).join("") : '<div class="empty"><strong>暂无候选内容</strong><p>系统不会用演示内容填充列表。</p></div>';
}

function renderScoreBreakdown(candidate) {
  $("#scoreBreakdown").innerHTML = scoreDimensions.map(([key, label]) =>
    `<div><span>${esc(label)}</span><strong>${score(candidate.score?.[key])}</strong><p>${esc(candidate.score_reasons?.[key] || "暂无评分理由")}</p></div>`,
  ).join("");
}

function renderRanking(ranking) {
  state.ranking = ranking;
  const preview = ranking?.preview || {};
  const policy = preview.policy || {};
  $("#rankingPolicy").innerHTML = `<div class="policy-head"><strong>自动选择策略</strong><span>${preview.qualified_count || 0} 条达标 · ${preview.selected_count || 0} 条进入窗口</span></div>
    <dl>
      <div><dt>质量阈值</dt><dd>${score(policy.quality_threshold)}</dd></div>
      <div><dt>Minimum</dt><dd>${esc(policy.minimum ?? "—")}</dd></div>
      <div><dt>Target</dt><dd>${esc(policy.target ?? "—")}</dd></div>
      <div><dt>Maximum</dt><dd>${esc(policy.maximum ?? "—")}</dd></div>
    </dl>`;

  const batch = ranking?.active_batch;
  const batchRun = ranking?.active_batch_run;
  const resultByCandidate = Object.fromEntries(
    (batchRun?.candidate_results || []).map((item) => [item.candidate_id, item]),
  );
  const candidates = batch?.ranking_snapshot || (preview.selected || []).map((item) => ({
    rank: item.rank,
    candidate_id: item.candidate.id,
    candidate_type: item.candidate.candidate_type,
    topic: item.candidate.topic,
    final_score: item.candidate.final_score,
  }));
  const batchState = batch ? `FROZEN · ${esc(batch.id.slice(0, 8))}` : "等待系统自动冻结";
  const frozenAt = batch?.frozen_at
    ? `冻结于 ${esc(new Date(batch.frozen_at).toLocaleString("zh-CN"))}`
    : preview.ready_to_freeze ? "候选已达到自动冻结条件" : "合格候选不足 Minimum";
  const readyCount = (batchRun?.candidate_results || []).filter(
    (item) => item.status === "HANDOFF_CREATED",
  ).length;
  const progressText = batchRun
    ? `${readyCount} / ${batchRun.candidate_results.length} 已完成交接 · 父任务 ${esc(batchRun.production_task_id.slice(0, 8))}`
    : batch ? "冻结完成，等待 Task Engine 启动批次生产" : "尚未形成冻结批次";
  $("#frozenBatch").innerHTML = `<div class="batch-head"><div><strong>活动批次</strong><span>${frozenAt}</span></div><em>${batchRun?.status || batchState}</em></div>
    <div id="batchProgress" class="batch-progress">${progressText}</div>
    <div id="batchCandidates" class="batch-candidates">${candidates.length ? candidates.map((item) => {
      const result = resultByCandidate[item.candidate_id];
      const sourceLabel = sourceTypeLabels[item.candidate_type] || item.candidate_type || "内容候选";
      const progress = result ? (batchStatusLabels[result.status] || result.status) : "等待生产";
      return `<div><b>#${esc(item.rank)}</b><span><strong>${esc(item.topic)}</strong><small>${esc(sourceLabel)} · ${esc(progress)}</small></span><em>${score(item.final_score)} 分</em></div>`;
    }).join("") : '<p class="empty-inline">当前没有可进入本批次的合格候选。</p>'}</div>`;
  const exclusions = preview.excluded || [];
  if (exclusions.length) {
    $("#batchCandidates").insertAdjacentHTML("beforeend", `<details class="selection-exclusions"><summary>${exclusions.length} 条未入选原因</summary>${exclusions.map((item) =>
      `<p><strong>${esc(item.candidate.topic)}</strong><span>${esc(selectionReasonLabels[item.reason] || item.reason)}</span></p>`,
    ).join("")}</details>`);
  }
}

function renderEvidence(production) {
  const references = production.evidence || [];
  $("#evidenceList").innerHTML = references.length
    ? references.map((reference) => {
      const source = reference.source_url
        ? `<a href="${esc(reference.source_url)}" target="_blank" rel="noreferrer">查看官方来源</a>`
        : "<span>来源链接待补充</span>";
      const verified = reference.verification_time
        ? `核验 ${esc(new Date(reference.verification_time).toLocaleDateString("zh-CN"))}`
        : "核验时间待补充";
      return `<div class="evidence-row"><div><strong>${esc(reference.label)}</strong><span>${esc(verified)} · 版本 ${esc(reference.version ?? "—")}</span></div>${source}</div>`;
    }).join("")
    : "<p>尚未形成可展示的证据引用；系统不会用未验证材料生成交付。</p>";
}

function renderContent(contentPackage) {
  const section = $("#contentSection");
  if (!contentPackage) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  $("#contentStatus").textContent = contentPackage.status === "GENERATED" ? "正文已生成" : contentPackage.status;
  $("#contentTitle").textContent = contentPackage.title || "标题待生成";
  $("#contentHook").textContent = contentPackage.hook || "";
  const claims = contentPackage.claims || [];
  $("#claimCoverage").innerHTML = claims.length
    ? claims.map((claim) => {
      const verified = claim.verification_state === "VERIFIED";
      const references = claim.evidence_references || [];
      return `<article class="claim ${verified ? "verified" : "unknown"}">
        <div><strong>${esc(claim.claim_key)}</strong><span>${verified ? "已核验" : "信息未知"}</span></div>
        <p>${esc(claim.text)}</p>
        <small>Program 字段：${esc(claim.program_field)} · ${references.length} 条版本化引用</small>
      </article>`;
    }).join("")
    : '<p class="empty-inline">当前正文包尚未返回结论级证据覆盖。</p>';
  $("#contentBody").innerHTML = esc(contentPackage.body || "正文正在由内容任务生成。").replace(/\n/g, "<br>");
  $("#hashtags").textContent = (contentPackage.hashtags || []).join(" ");
}

function renderVisual(visual, visualPagePlan, contentPackage) {
  const section = $("#visualSection");
  if (!visual) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const pages = visualPagePlan?.pages || [];
  const artifacts = visual.artifacts || [];
  const style_family = visualPagePlan?.style_family || "尚未选择";
  const style_variant = visualPagePlan?.style_variant || "尚未选择";
  const component_schema = visualPagePlan?.component_schema || [];
  const brand_tokens = visualPagePlan?.brand_tokens || {};
  const style_fingerprint = visualPagePlan?.style_fingerprint || "—";
  const similarity_result = visualPagePlan?.similarity_result || {};
  $("#visualState").textContent = visual.qa_result?.status === "PASS" ? "QA 已通过" : "QA 需要复核";
  $("#visualGovernance").innerHTML = `
    <div><span>Style Family</span><strong>${esc(style_family)}</strong></div>
    <div><span>Style Variant</span><strong>${esc(style_variant)}</strong></div>
    <div><span>组件合同</span><strong>${esc(component_schema.join(" · ") || "尚未返回")}</strong></div>
    <div><span>品牌 Token</span><strong>${esc(brand_tokens.version || "尚未返回")}</strong></div>
    <div><span>移动端安全区</span><strong>${esc(brand_tokens.safe_area ? `${brand_tokens.safe_area.left}/${brand_tokens.safe_area.top}/${brand_tokens.safe_area.right}/${brand_tokens.safe_area.bottom}` : "尚未返回")}</strong></div>
    <div><span>相似度控制</span><strong>${esc(similarity_result.status || "尚未检查")}</strong><small>${esc(similarity_result.diagnostic || style_fingerprint)}</small></div>`;
  $("#visualPlan").innerHTML = pages.length
    ? pages.map((page) => `<div><b>第 ${page.page_number || page.sequence} 页</b><span>${esc(page.template?.template_id || "模板待确认")}</span><p>${esc(page.headline)}</p></div>`).join("")
    : "<div><b>视觉页面计划缺失</b><p>读取模型会保留部分链路并显示下一步。</p></div>";
  $("#visualGallery").innerHTML = pages.map((page, index) => {
    const artifact = artifacts[index];
    return `<figure class="visual-slide visual-page">
      ${artifact?.uri ? `<img src="${esc(artifact.uri)}" alt="第 ${page.page_number || index + 1} 页：${esc(page.headline)}">` : '<div class="artifact-missing">渲染文件缺失</div>'}
      <figcaption><strong>第 ${index + 1} 页</strong><span>${esc(page.template?.template_id || "")} · 1080×1440</span></figcaption>
    </figure>`;
  }).join("");
  const rules = visual?.qa_result?.rules || [];
  $("#qaRules").innerHTML = rules.map((item) =>
    `<li class="${item.passed ? "pass" : "fail"}"><strong>${item.passed ? "通过" : "未通过"} · ${esc(item.name)}</strong><span>${esc(item.diagnostic || "暂无诊断")}</span></li>`,
  ).join("");
  if (!pages.length && contentPackage) {
    $("#visualGallery").innerHTML = '<p class="empty-inline">视觉输出存在，但页面计划尚未进入读取模型。</p>';
  }
}

function renderDeliveryAndTrace(production) {
  const delivery = production.delivery_package;
  if (delivery) {
    const payload = delivery.text_payload || {};
    $("#deliveryManifest").innerHTML = `<div class="manifest-head"><strong>Atlas 交接清单</strong><span>${esc(delivery.delivery_status)}</span></div>
      <dl>
        <dt>渠道</dt><dd>${esc(delivery.channel)}</dd>
        <dt>标题</dt><dd>${esc(payload.title)}</dd>
        <dt>视觉资产</dt><dd>${(delivery.asset_references || []).length} 个</dd>
        <dt>证据引用</dt><dd>${(payload.evidence_references || []).length} 条</dd>
        <dt>外部引用</dt><dd>${esc(delivery.external_reference || "待生成")}</dd>
      </dl>
      <p>${esc(payload.publication_note || "Atlas 交接已创建，尚未执行外部平台发布。")}</p>`;
  } else {
    $("#deliveryManifest").innerHTML = "<p>尚未形成交接清单；视觉 QA 通过后才能创建。</p>";
  }
  const workspace = production.publication;
  if (workspace?.publication) {
    const publication = workspace.publication;
    const dispatch = workspace.dispatch;
    const target_validation = dispatch?.target_validation || {};
    const scheduled_for = publication.scheduled_for;
    const external_confirmation = publication.external_confirmation || {};
    const tracking = workspace.tracking;
    const cleanup = workspace.cleanup;
    const targetLabel = target_validation.contact_id === "filehelper"
      ? "文件传输助手 · 已验证"
      : target_validation.status || "尚未验证";
    $("#publishingWorkspace").innerHTML = `<div class="publishing-head"><div><strong>Publishing Workspace</strong><span>${esc(publication.state)} · ${esc(publication.mode)}</span></div><em>${dispatch ? esc(dispatch.dispatch_status) : "等待安全适配"}</em></div>
      <dl>
        <dt>目标验证</dt><dd>${esc(targetLabel)}</dd>
        <dt>计划时间</dt><dd>${esc(scheduled_for ? new Date(scheduled_for).toLocaleString("zh-CN") : "尚未排期")}</dd>
        <dt>外部确认</dt><dd>${esc(external_confirmation.public_post_id || "尚未确认发布")}</dd>
        <dt>公开追踪</dt><dd>${tracking ? `仅公开 / Guest · ${esc(tracking.observed_at)}` : "仅公开 / Guest · 尚未采集"}</dd>
        <dt>清理状态</dt><dd>${esc(cleanup?.cleanup_status || "尚未开始")}</dd>
      </dl>
      <p>${publication.state === "PUBLISHED" ? "已收到外部公开帖子确认。" : "当前仅为安全交接状态，不代表外部平台已发布。"}</p>`;
  } else {
    $("#publishingWorkspace").innerHTML = '<p class="empty-inline">尚未创建 PublicationRecord；Atlas 交接不等于外部平台发布。</p>';
  }
  const trace = production.trace || {};
  const traceRows = [
    ["候选 Agent Trace", trace.candidate_trace_id],
    ["正文 Task", trace.content_generation_task_id],
    ["视觉页面计划", trace.visual_page_plan_id],
    ["视觉 Task", trace.visual_render_task_id],
    ["交付 Task", trace.delivery_task_id],
  ];
  $("#traceDetail").innerHTML = `<h3>Task / Agent Trace</h3>${traceRows.map(([label, value]) =>
    `<div><span>${esc(label)}</span><code>${esc(value || "尚未生成")}</code></div>`,
  ).join("")}`;
}

function renderDetail(production) {
  const candidate = production.candidate;
  const productionState = statusFor(candidate);
  $("#emptyDetail").hidden = true;
  $("#detail").hidden = false;
  $("#topicTitle").textContent = candidate.topic || "待生成选题";
  $("#candidateMeta").textContent = `${sourceTypeLabels[candidate.candidate_type] || candidate.candidate_type || "内容候选"} · 由版本化证据自动生成`;
  $("#productionState").textContent = productionState.label;
  const explanation = workflowExplanation(production);
  const nextAction = $("#nextAction");
  nextAction.textContent = explanation.text;
  nextAction.dataset.blocked = explanation.blocked ? "true" : "false";
  $("#targetAudience").textContent = candidate.target_audience || "目标读者待确认";
  $("#recommendedAngle").textContent = candidate.recommended_angle || "推荐角度待生成";
  $("#finalScore").textContent = `${score(candidate.final_score)} 分`;
  renderScoreBreakdown(candidate);
  renderContent(production.content_package);
  renderVisual(production.visual_render_output, production.visual_page_plan, production.content_package);
  renderEvidence(production);
  renderDeliveryAndTrace(production);
  renderCandidates();
}

async function selectCandidate(id) {
  state.selectedId = id;
  const production = await request(`/api/content/candidates/${encodeURIComponent(id)}/production`);
  state.productionsByCandidate[id] = production;
  renderDetail(production);
}

function renderLearning(learning) {
  const summary = learning?.summary || {};
  const latest = learning?.latest || {};
  const cards = [
    ["公开效果快照", summary.performance_snapshots, "只读取公开 / Guest 指标"],
    ["待治理学习候选", summary.pending_candidates, "不会自动升级为正式规则"],
    ["正式规则", summary.active_rules, `${summary.approved_decisions || 0} 条批准 · ${summary.rejected_decisions || 0} 条拒绝`],
    ["生命周期清理", summary.completed_cleanups, "确认发布后保留证据并归档临时生产对象"],
  ];
  $("#learningSummary").innerHTML = cards.map(([label, value, note]) =>
    `<article><span>${esc(label)}</span><strong>${esc(value ?? 0)}</strong><small>${esc(note)}</small></article>`,
  ).join("");
  const candidate = latest.candidate;
  const rule = latest.rule;
  const cleanup = latest.cleanup;
  $("#learningLatest").innerHTML = candidate || rule || cleanup
    ? `<div><strong>最近学习候选</strong><span>${esc(candidate?.status || "暂无")} · 置信度 ${esc(candidate?.confidence ?? "—")}</span></div>
      <div><strong>最近治理决策 / 正式规则</strong><span>${esc(latest.decision?.decision || "尚无决策")} · ${esc(rule?.statement || latest.decision?.reason || "尚未形成正式规则")}</span></div>
      <div><strong>最近清理记录</strong><span>${cleanup ? `${esc(cleanup.status)} · ${(cleanup.archived_object_ids || []).length} 个对象` : "尚无已完成清理"}</span></div>`
    : '<p class="empty-inline">尚无公开效果快照；确认发布并完成公开采集后，系统才会生成学习候选。</p>';
}

function setPageState(stateName, message) {
  const stateLabels = {
    LOADING: "正在同步 Content Factory",
    READY: "全链路状态已同步",
    EMPTY: "暂无可生产内容",
    ERROR: "状态读取失败",
  };
  const element = $("#pageState");
  element.className = `page-state ${stateName.toLowerCase()}`;
  element.dataset.state = stateName;
  element.innerHTML = `<strong>${esc(stateLabels[stateName] || stateName)}</strong><span>${esc(message)}</span>`;
}

function renderHealth(health) {
  const counts = health?.counts || {};
  $("#factoryHealth").dataset.status = health?.status || "READY";
  $("#healthMetrics").innerHTML = healthMetricLabels.map(([key, label]) =>
    `<article class="${key === "failed" && counts[key] ? "critical" : ""}"><span>${esc(label)}</span><strong>${esc(counts[key] ?? 0)}</strong></article>`,
  ).join("");
  $("#healthStages").innerHTML = (health?.stages || []).map((stage) =>
    `<article class="${stage.blocker ? "blocked" : ""}">
      <div><strong>${esc(stage.name)}</strong><em>${esc(stageStateLabels[stage.state] || stage.state)}</em></div>
      <dl><dt>责任方</dt><dd>${esc(stage.owner)}</dd><dt>来源</dt><dd><code>${esc(stage.source || "尚未形成")}</code></dd><dt>Task</dt><dd><code>${esc(stage.task_id || "尚未创建")}</code></dd><dt>下一步</dt><dd>${esc(stage.next_action)}</dd></dl>
      <p>${esc(stage.blocker || "当前无阻塞")}</p>
    </article>`,
  ).join("") || '<p class="empty-inline">暂无阶段健康数据。</p>';
}

async function load() {
  const [response, ranking, learning, health] = await Promise.all([
    request("/api/content/candidate-productions"),
    request("/api/content/ranking"),
    request("/api/content/learning"),
    request("/api/content/health"),
  ]);
  const productions = response.candidate_productions || [];
  renderRanking(ranking);
  renderLearning(learning);
  renderHealth(health);
  state.candidates = productions.map((item) => item.candidate);
  state.productionsByCandidate = Object.fromEntries(
    productions.map((item) => [item.candidate.id, item]),
  );
  $("#candidateCount").textContent = productions.length;
  $("#packageCount").textContent = productions.filter((item) => item.content_package).length;
  $("#visualCount").textContent = productions.filter(
    (item) => item.visual_render_output?.qa_result?.status === "PASS",
  ).length;
  $("#deliveryCount").textContent = productions.filter(
    (item) => item.delivery_package?.delivery_status === "HANDOFF_CREATED",
  ).length;
  renderCandidates();
  if (state.selectedId && state.productionsByCandidate[state.selectedId]) {
    renderDetail(state.productionsByCandidate[state.selectedId]);
  }
  return productions.length;
}

async function runLoad(successMessage = "") {
  setPageState("LOADING", "正在读取候选、冻结批次、生产、发布与学习治理状态。");
  try {
    const productionCount = await load();
    setPageState(
      productionCount ? "READY" : "EMPTY",
      productionCount
        ? `已对账 ${productionCount} 条候选及全部自动阶段。`
        : "系统不会使用演示内容填充；等待已验证 Program 或公开 Strategy 输入。",
    );
    if (successMessage) toast(successMessage);
  } catch (error) {
    setPageState("ERROR", `无法读取自动生产状态：${error.message}`);
    toast(error.message, true);
    throw error;
  }
}

$("#candidateList").addEventListener("click", (event) => {
  const row = event.target.closest("[data-id]");
  if (row) selectCandidate(row.dataset.id).catch((error) => toast(error.message, true));
});
$("#refresh").addEventListener("click", () =>
  runLoad("内容状态已刷新").catch(() => {}),
);
runLoad().catch(() => {});
