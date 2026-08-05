import { getApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

const NEXUS_PAGES = new Set([
  "page-dashboard",
  "page-announcements",
  "page-planner",
  "page-settings"
]);

const state = {
  user: null,
  role: null,
  profile: {},
  courses: [],
  enrollments: [],
  exams: [],
  quizzes: [],
  meetings: [],
  submissions: [],
  quizAttempts: [],
  announcements: [],
  tasks: [],
  dashboardLoadedAt: 0,
  announcementEditingId: null,
  plannerMonth: startOfMonth(new Date()),
  selectedPlannerDate: dateKey(new Date()),
  loading: new Set(),
  routeSequence: 0,
  authSequence: 0,
  lastRoutePage: "",
  lastRouteAt: 0
};

function core() {
  return window.ExamFlowCore || null;
}

function toast(message, ok = true) {
  if (core()?.toast) core().toast(message, ok);
  else console[ok ? "log" : "error"](message);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function valueToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object" && Number.isFinite(value.seconds)) {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtDate(value, withTime = true) {
  const date = valueToDate(value);
  if (!date) return "—";
  return date.toLocaleString("vi-VN", withTime
    ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtRelative(value) {
  const date = valueToDate(value);
  if (!date) return "Không xác định";
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const future = diff >= 0;
  if (abs < 60_000) return future ? "Sắp diễn ra" : "Vừa xong";
  if (abs < 3_600_000) {
    const n = Math.max(1, Math.round(abs / 60_000));
    return future ? `Còn ${n} phút` : `${n} phút trước`;
  }
  if (abs < 86_400_000) {
    const n = Math.max(1, Math.round(abs / 3_600_000));
    return future ? `Còn ${n} giờ` : `${n} giờ trước`;
  }
  const n = Math.max(1, Math.round(abs / 86_400_000));
  return future ? `Còn ${n} ngày` : `${n} ngày trước`;
}

function dateKey(value) {
  const date = valueToDate(value) || new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfMonth(value) {
  const date = valueToDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(value) {
  const date = valueToDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function toLocalDateTimeValue(value) {
  const date = valueToDate(value);
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function chunk(items, size = 10) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function uniqueBy(items, keyFn) {
  const map = new Map();
  items.forEach(item => map.set(keyFn(item), item));
  return [...map.values()];
}

function newestFirst(items, field = "createdAt") {
  return items.slice().sort((a, b) => {
    const av = valueToDate(a[field])?.getTime() || 0;
    const bv = valueToDate(b[field])?.getTime() || 0;
    return bv - av;
  });
}

function scoreValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10, number)) : null;
}

function average(numbers) {
  const valid = numbers.filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

function priorityLabel(value) {
  return ({ urgent: "Khẩn cấp", important: "Quan trọng", normal: "Bình thường", critical: "Rất cao", high: "Cao" })[value] || "Bình thường";
}

function roleLabel(role) {
  return role === "giaovien" ? "Giáo viên" : "Học sinh";
}

function courseName(course) {
  return course?.tenHocPhan || course?.maHocPhan || "Học phần";
}

async function safeDocs(collectionName, constraints = []) {
  try {
    const ref = collection(db, collectionName);
    const snapshot = await withTimeout(getDocs(constraints.length ? query(ref, ...constraints) : ref));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.error(`Nexus query ${collectionName} failed:`, error);
    return [];
  }
}

async function docsByIn(collectionName, field, values, extraConstraints = []) {
  const ids = [...new Set(values.filter(Boolean))];
  if (!ids.length) return [];
  const groups = chunk(ids, 10);
  const results = await Promise.all(groups.map(group => safeDocs(collectionName, [where(field, "in", group), ...extraConstraints])));
  return uniqueBy(results.flat(), item => item.id);
}

function withTimeout(promise, ms = 15000) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("Kết nối Firebase quá thời gian chờ."), { code: "nexus/timeout" })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function setLoading(name, on) {
  if (on) state.loading.add(name);
  else state.loading.delete(name);
  document.body.classList.toggle("nexus-busy", state.loading.size > 0);
}

function currentRoute() {
  return document.querySelector(".page.active")?.id || "";
}

function currentCourseIds() {
  if (state.role === "giaovien") return state.courses.map(item => item.id);
  return state.enrollments.map(item => item.hocPhanId).filter(Boolean);
}

function readAnnouncementIds() {
  if (!state.user) return new Set();
  try {
    const raw = localStorage.getItem(`examflow-announcement-read:${state.user.uid}`);
    return new Set(JSON.parse(raw || "[]"));
  } catch {
    return new Set();
  }
}

function writeAnnouncementIds(ids) {
  if (!state.user) return;
  try {
    localStorage.setItem(`examflow-announcement-read:${state.user.uid}`, JSON.stringify([...ids].slice(-500)));
  } catch {}
}

function setSettingsSaveState(message, mode = "ok") {
  const root = $("settings-save-state");
  if (!root) return;
  root.dataset.mode = mode;
  const label = root.querySelector("span");
  if (label) label.textContent = message;
}

async function loadProfile() {
  if (!state.user) return {};
  try {
    const snap = await withTimeout(getDoc(doc(db, "users", state.user.uid)));
    state.profile = snap.exists() ? snap.data() : {};
  } catch (error) {
    state.profile = {};
    console.warn("Không tải được hồ sơ Nexus:", error);
  }
  state.role = state.profile.role === "giaovien" ? "giaovien" : (core()?.currentRole || "hocsinh");
  return state.profile;
}

async function loadBaseCourses(force = false) {
  if (!state.user) return [];
  if (!force && state.courses.length) return state.courses;
  if (state.role === "giaovien") {
    state.courses = newestFirst(await safeDocs("hoc_phan", [where("giaoVienId", "==", state.user.uid)]));
    state.enrollments = await docsByIn("ghi_danh", "hocPhanId", state.courses.map(item => item.id));
  } else {
    state.enrollments = newestFirst(await safeDocs("ghi_danh", [where("uid", "==", state.user.uid)]));
    const courseIds = state.enrollments.map(item => item.hocPhanId).filter(Boolean);
    const courseDocs = await Promise.all(courseIds.map(async id => {
      try {
        const snap = await withTimeout(getDoc(doc(db, "hoc_phan", id)));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
      } catch {
        return null;
      }
    }));
    state.courses = courseDocs.filter(Boolean);
  }
  return state.courses;
}

async function loadLearningData(force = false) {
  if (!state.user) return;
  if (!force && state.dashboardLoadedAt && Date.now() - state.dashboardLoadedAt < 45_000) return;
  await loadBaseCourses(force);
  const courseIds = currentCourseIds();
  if (state.role === "giaovien") {
    const [exams, quizzes, meetings, submissions] = await Promise.all([
      safeDocs("de_thi", [where("uploadedBy", "==", state.user.uid)]),
      safeDocs("trac_nghiem", [where("giaoVienId", "==", state.user.uid)]),
      safeDocs("phong_hop", [where("giaoVienId", "==", state.user.uid)]),
      docsByIn("bai_nop", "hocPhanId", courseIds)
    ]);
    state.exams = exams;
    state.quizzes = quizzes;
    state.meetings = meetings;
    state.submissions = submissions;
    state.quizAttempts = await docsByIn("bai_lam_trac_nghiem", "quizId", quizzes.map(item => item.id));
  } else {
    const [exams, quizzes, meetings, submissions, attempts] = await Promise.all([
      docsByIn("de_thi", "hocPhanId", courseIds),
      docsByIn("trac_nghiem", "hocPhanId", courseIds),
      docsByIn("phong_hop", "hocPhanId", courseIds),
      safeDocs("bai_nop", [where("uid", "==", state.user.uid)]),
      safeDocs("bai_lam_trac_nghiem", [where("uid", "==", state.user.uid)])
    ]);
    state.exams = exams;
    state.quizzes = quizzes;
    state.meetings = meetings;
    state.submissions = submissions;
    state.quizAttempts = attempts;
  }
  state.dashboardLoadedAt = Date.now();
}

function dashboardScores() {
  const submissionScores = state.submissions.map(item => scoreValue(item.diem)).filter(Number.isFinite);
  const quizScores = state.quizAttempts
    .filter(item => item.hienDiemNgay !== false || state.role === "giaovien")
    .map(item => scoreValue(item.diem))
    .filter(Number.isFinite);
  return [...submissionScores, ...quizScores];
}

function readinessScore() {
  const scores = dashboardScores();
  const avg = average(scores);
  const now = Date.now();
  const upcoming = buildSystemEvents().filter(item => item.date.getTime() >= now && item.date.getTime() < now + 7 * 86_400_000).length;
  const overdueTasks = state.tasks.filter(item => item.status !== "done" && valueToDate(item.dueAt)?.getTime() < now).length;
  const base = avg == null ? 68 : avg * 10;
  return Math.max(15, Math.min(99, Math.round(base - upcoming * 1.4 - overdueTasks * 4 + Math.min(10, state.courses.length))));
}

function buildMetricData() {
  const scores = dashboardScores();
  const avg = average(scores);
  if (state.role === "giaovien") {
    const students = new Set(state.enrollments.map(item => item.uid).filter(Boolean)).size;
    const pending = state.submissions.filter(item => scoreValue(item.diem) == null).length;
    const upcoming = buildSystemEvents().filter(item => item.date.getTime() > Date.now()).length;
    return [
      { icon: "⌂", label: "Học phần đang quản lý", value: state.courses.length, note: `${students} học sinh ghi danh`, tone: "brand" },
      { icon: "↓", label: "Bài đang chờ chấm", value: pending, note: pending ? "Cần phản hồi học sinh" : "Đã xử lý toàn bộ", tone: pending ? "warning" : "success" },
      { icon: "◒", label: "Điểm trung bình lớp", value: avg == null ? "—" : avg.toFixed(1), note: `${scores.length} kết quả đã ghi nhận`, tone: "violet" },
      { icon: "◷", label: "Sự kiện sắp tới", value: upcoming, note: "Đề thi, lịch học và nhiệm vụ", tone: "cyan" }
    ];
  }
  const submittedExamIds = new Set(state.submissions.map(item => item.deThiId));
  const pendingExams = state.exams.filter(item => !submittedExamIds.has(item.id) && (!valueToDate(item.deadlineAt) || valueToDate(item.deadlineAt).getTime() > Date.now())).length;
  const upcomingMeetings = state.meetings.filter(item => valueToDate(item.batDauAt)?.getTime() > Date.now()).length;
  return [
    { icon: "◇", label: "Học phần đã tham gia", value: state.courses.length, note: "Không gian học tập hiện tại", tone: "brand" },
    { icon: "↗", label: "Bài cần hoàn thành", value: pendingExams, note: pendingExams ? "Hãy kiểm tra hạn nộp" : "Không có bài tồn đọng", tone: pendingExams ? "warning" : "success" },
    { icon: "◒", label: "Điểm trung bình", value: avg == null ? "—" : avg.toFixed(1), note: `${scores.length} kết quả đã công bố`, tone: "violet" },
    { icon: "◎", label: "Lịch học sắp tới", value: upcomingMeetings, note: "Buổi học trực tuyến", tone: "cyan" }
  ];
}

function renderDashboardMetrics() {
  const root = $("nexus-metric-grid");
  if (!root) return;
  root.innerHTML = buildMetricData().map(metric => `
    <article class="nexus-metric-card ${metric.tone}">
      <span class="nexus-metric-icon">${metric.icon}</span>
      <div><small>${escapeHtml(metric.label)}</small><strong>${escapeHtml(metric.value)}</strong><p>${escapeHtml(metric.note)}</p></div>
    </article>`).join("");
}

function buildSystemEvents() {
  const events = [];
  state.exams.forEach(item => {
    const date = valueToDate(item.deadlineAt);
    if (date) events.push({ id: `exam:${item.id}`, type: "exam", title: item.tenDe || item.tieuDe || item.fileName || "Hạn nộp đề thi", course: item.tenHocPhan || item.maHocPhan || "Học phần", date, source: item });
  });
  state.meetings.forEach(item => {
    const date = valueToDate(item.batDauAt);
    if (date) events.push({ id: `meeting:${item.id}`, type: "meeting", title: item.tieuDe || item.tenPhong || "Lớp học trực tuyến", course: item.tenHocPhan || item.maHocPhan || "Học phần", date, source: item });
  });
  state.tasks.forEach(item => {
    const date = valueToDate(item.dueAt);
    if (date) events.push({ id: `task:${item.id}`, type: "task", title: item.title || "Nhiệm vụ cá nhân", course: item.description || "Kế hoạch cá nhân", date, source: item });
  });
  return events.sort((a, b) => a.date - b.date);
}

function renderDashboardTimeline() {
  const root = $("nexus-timeline");
  if (!root) return;
  const now = Date.now();
  const events = buildSystemEvents().filter(item => item.date.getTime() > now - 3_600_000).slice(0, 7);
  if (!events.length) {
    root.innerHTML = `<div class="nexus-empty-state"><span>✓</span><strong>Lịch trình đang thông thoáng</strong><small>Không có hạn nộp hoặc lịch học sắp diễn ra.</small></div>`;
    return;
  }
  root.innerHTML = events.map((event, index) => {
    const urgent = event.date.getTime() - now < 24 * 3_600_000;
    return `<article class="nexus-timeline-item ${event.type} ${urgent ? "urgent" : ""}">
      <div class="nexus-timeline-line"><i></i>${index < events.length - 1 ? "<span></span>" : ""}</div>
      <div class="nexus-timeline-copy"><small>${escapeHtml(event.course)}</small><strong>${escapeHtml(event.title)}</strong><p>${fmtDate(event.date)} · ${fmtRelative(event.date)}</p></div>
      <b>${event.type === "exam" ? "ĐỀ" : event.type === "meeting" ? "LIVE" : "TASK"}</b>
    </article>`;
  }).join("");
}

function activityItems() {
  const items = [];
  state.submissions.forEach(item => items.push({ icon: "↗", title: state.role === "giaovien" ? `${item.hoTen || "Học sinh"} đã nộp bài` : `Đã nộp ${item.tenDe || item.tenDeThi || "bài làm"}`, text: item.tenHocPhan || item.maHocPhan || "Học phần", date: item.createdAt || item.nopAt }));
  state.quizAttempts.forEach(item => items.push({ icon: "◆", title: state.role === "giaovien" ? `${item.hoTen || "Học sinh"} hoàn thành trắc nghiệm` : `Hoàn thành ${item.tieuDe || "trắc nghiệm"}`, text: scoreValue(item.diem) == null ? "Kết quả chưa công bố" : `Điểm ${Number(item.diem).toFixed(1)}/10`, date: item.createdAt }));
  state.announcements.forEach(item => items.push({ icon: "◈", title: item.title || "Thông báo học phần", text: item.tenHocPhan || item.maHocPhan || "Bảng tin", date: item.createdAt }));
  return newestFirst(items).slice(0, 8);
}

function renderActivityFeed() {
  const root = $("nexus-activity-feed");
  if (!root) return;
  const items = activityItems();
  if (!items.length) {
    root.innerHTML = `<div class="nexus-empty-state compact"><span>○</span><strong>Chưa có hoạt động gần đây</strong><small>Các bài nộp và kết quả mới sẽ xuất hiện tại đây.</small></div>`;
    return;
  }
  root.innerHTML = items.map(item => `<article><span>${item.icon}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></div><time>${fmtRelative(item.date)}</time></article>`).join("");
}

function renderQuickActions() {
  const root = $("nexus-quick-actions");
  if (!root) return;
  const actions = state.role === "giaovien" ? [
    { icon: "＋", title: "Tạo học phần", text: "Mở không gian lớp mới", page: "page-hoc-phan" },
    { icon: "⇧", title: "Đăng đề thi", text: "Phân phối tài liệu và hạn nộp", page: "page-dang-de" },
    { icon: "◆", title: "Tạo Battle Quiz", text: "Thiết kế mini game trắc nghiệm", page: "page-trac-nghiem-gv" },
    { icon: "◈", title: "Phát thông báo", text: "Cập nhật tới toàn bộ lớp", page: "page-announcements" }
  ] : [
    { icon: "◇", title: "Ghi danh học phần", text: "Tham gia lớp bằng mật khẩu", page: "page-ghi-danh" },
    { icon: "↗", title: "Nộp bài", text: "Gửi bài làm an toàn", page: "page-nop-bai" },
    { icon: "◆", title: "Vào Battle Arena", text: "Làm bài trắc nghiệm dạng game", page: "page-trac-nghiem-hs" },
    { icon: "◒", title: "Xem phân tích điểm", text: "Theo dõi tiến độ học tập", page: "page-ket-qua" }
  ];
  root.innerHTML = actions.map(item => `<button type="button" data-nexus-route="${item.page}"><span>${item.icon}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.text)}</small></div><b>→</b></button>`).join("");
  bindRouteButtons(root);
}

function scoreSeries() {
  const items = [];
  state.submissions.forEach(item => {
    const score = scoreValue(item.diem);
    if (score != null) items.push({ label: item.tenDe || item.tenDeThi || "Bài nộp", score, date: valueToDate(item.gradedAt || item.createdAt) || new Date(0), type: "Tự luận" });
  });
  state.quizAttempts.forEach(item => {
    const score = scoreValue(item.diem);
    if (score != null && (state.role === "giaovien" || item.hienDiemNgay !== false)) items.push({ label: item.tieuDe || "Trắc nghiệm", score, date: valueToDate(item.createdAt) || new Date(0), type: "Trắc nghiệm" });
  });
  return items.sort((a, b) => a.date - b.date);
}

function drawPerformanceChart() {
  const canvas = $("nexus-performance-chart");
  const empty = $("nexus-chart-empty");
  if (!canvas) return;
  const requested = Number($("nexus-chart-range")?.value || 14);
  const series = scoreSeries().slice(-requested);
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(340, Math.round(rect.width || 760));
  const height = Math.max(240, Math.round(rect.height || 320));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  if (series.length < 2) {
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");
  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue("--primary").trim() || "#635bff";
  const text = styles.getPropertyValue("--muted").trim() || "#7b8196";
  const border = styles.getPropertyValue("--border-strong").trim() || "rgba(20,20,30,.12)";
  const panel = styles.getPropertyValue("--surface-solid").trim() || "#fff";
  const padding = { left: 42, right: 18, top: 22, bottom: 38 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  context.font = '11px "Be Vietnam Pro", sans-serif';
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.strokeStyle = border;
  context.fillStyle = text;
  context.lineWidth = 1;
  for (let value = 0; value <= 10; value += 2) {
    const y = padding.top + chartHeight - (value / 10) * chartHeight;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(String(value), padding.left - 9, y);
  }
  const points = series.map((item, index) => ({
    ...item,
    x: padding.left + (index / Math.max(1, series.length - 1)) * chartWidth,
    y: padding.top + chartHeight - (item.score / 10) * chartHeight
  }));
  const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
  gradient.addColorStop(0, `${accent}55`);
  gradient.addColorStop(1, `${accent}05`);
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.lineTo(points[points.length - 1].x, padding.top + chartHeight);
  context.lineTo(points[0].x, padding.top + chartHeight);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.strokeStyle = accent;
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();
  points.forEach(point => {
    context.beginPath();
    context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
    context.fillStyle = panel;
    context.fill();
    context.strokeStyle = accent;
    context.lineWidth = 2.5;
    context.stroke();
  });
  context.fillStyle = text;
  context.textAlign = "center";
  context.textBaseline = "top";
  const labelStep = Math.max(1, Math.ceil(series.length / 6));
  points.forEach((point, index) => {
    if (index % labelStep !== 0 && index !== points.length - 1) return;
    context.fillText(point.date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }), point.x, padding.top + chartHeight + 12);
  });
  const legend = $("nexus-chart-legend");
  if (legend) {
    const avg = average(series.map(item => item.score));
    const best = Math.max(...series.map(item => item.score));
    legend.innerHTML = `<span><i></i>Điểm theo thời gian</span><strong>Trung bình ${avg.toFixed(1)} · Cao nhất ${best.toFixed(1)}</strong>`;
  }
}

async function loadDashboard(force = false) {
  if (!state.user) return;
  setLoading("dashboard", true);
  const sequence = ++state.routeSequence;
  try {
    await Promise.all([loadLearningData(force), loadTasks(false), loadAnnouncements(false)]);
    if (sequence !== state.routeSequence && currentRoute() !== "page-dashboard") return;
    applyDashboardWelcomeContent();
    $("nexus-primary-action").dataset.nexusRoute = state.role === "giaovien" ? "page-bai-nop" : "page-nop-bai";
    $("nexus-primary-action").querySelector("span").textContent = state.role === "giaovien" ? "Mở trung tâm chấm bài" : "Tiếp tục nhiệm vụ học tập";
    $("nexus-readiness-value").textContent = readinessScore();
    $("nexus-sync-label").textContent = `Đồng bộ lúc ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
    renderDashboardMetrics();
    renderDashboardTimeline();
    renderActivityFeed();
    renderQuickActions();
    bindRouteButtons($("page-dashboard"));
    requestAnimationFrame(drawPerformanceChart);
  } catch (error) {
    console.error("Dashboard error:", error);
    toast("Không tải được toàn bộ dữ liệu tổng quan: " + (error.message || error), false);
  } finally {
    setLoading("dashboard", false);
  }
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

function dashboardHeroConfig() {
  return window.ExamFlowDashboardHeroConfig || {
    titleTemplate: "{greeting}, {name}",
    subtitle: ""
  };
}

function applyDashboardWelcomeContent() {
  if (!state.user) return;
  const displayName = state.profile.hoTen || core()?.currentUserName || state.user.displayName || state.user.email || "Bạn";
  const shortName = displayName.split(/\s+/).slice(-2).join(" ");
  const config = dashboardHeroConfig();
  const titleTemplate = String(config.titleTemplate || "{greeting}, {name}");
  const title = titleTemplate
    .replaceAll("{greeting}", greeting())
    .replaceAll("{name}", shortName)
    .trim();

  if ($("nexus-welcome-title")) $("nexus-welcome-title").textContent = title || `${greeting()}, ${shortName}`;
  if ($("nexus-welcome-subtitle")) {
    $("nexus-welcome-subtitle").textContent = String(config.subtitle || "").trim() || (
      state.role === "giaovien"
        ? "Tổng hợp lớp học, bài cần chấm và lịch giảng dạy trong một màn hình điều hành."
        : "Tiến độ học tập, lịch sắp tới và kết quả mới nhất đã sẵn sàng."
    );
  }
}

window.addEventListener("examflow:dashboard-hero-config", () => {
  applyDashboardWelcomeContent();
});

async function loadAnnouncements(force = false) {
  if (!state.user) return [];
  if (!force && state.announcements.length) return state.announcements;
  await loadBaseCourses(force);
  if (state.role === "giaovien") {
    state.announcements = newestFirst(await safeDocs("thong_bao_hoc_phan", [where("giaoVienId", "==", state.user.uid)]), "updatedAt");
  } else {
    state.announcements = newestFirst(await docsByIn("thong_bao_hoc_phan", "hocPhanId", currentCourseIds()), "updatedAt");
  }
  updateAnnouncementBadge();
  return state.announcements;
}

function fillCourseSelects() {
  const options = state.courses.map(course => `<option value="${escapeHtml(course.id)}">${escapeHtml(courseName(course))}</option>`).join("");
  if ($("announcement-course")) $("announcement-course").innerHTML = options || '<option value="">Chưa có học phần</option>';
  if ($("announcement-course-filter")) {
    const current = $("announcement-course-filter").value;
    $("announcement-course-filter").innerHTML = '<option value="">Tất cả học phần</option>' + options;
    $("announcement-course-filter").value = current;
  }
}

function announcementFiltered() {
  const search = normalize($("announcement-search")?.value || "");
  const courseId = $("announcement-course-filter")?.value || "";
  const priority = $("announcement-priority-filter")?.value || "";
  return state.announcements.filter(item => {
    if (courseId && item.hocPhanId !== courseId) return false;
    if (priority && item.priority !== priority) return false;
    if (search && !normalize(`${item.title} ${item.content} ${item.tenHocPhan} ${item.giaoVienTen}`).includes(search)) return false;
    return true;
  }).sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return (valueToDate(b.updatedAt || b.createdAt)?.getTime() || 0) - (valueToDate(a.updatedAt || a.createdAt)?.getTime() || 0);
  });
}

function updateAnnouncementBadge() {
  const read = readAnnouncementIds();
  const unread = state.announcements.filter(item => !read.has(item.id)).length;
  const badge = $("announcement-nav-badge");
  if (badge) {
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.classList.toggle("hidden", unread === 0);
  }
}

function renderAnnouncements() {
  const root = $("announcement-list");
  if (!root) return;
  const items = announcementFiltered();
  const read = readAnnouncementIds();
  if (!items.length) {
    root.innerHTML = `<div class="card nexus-empty-state large"><span>◈</span><strong>Chưa có thông báo phù hợp</strong><small>${state.role === "giaovien" ? "Hãy tạo thông báo đầu tiên cho học phần." : "Giáo viên chưa đăng cập nhật mới."}</small></div>`;
    return;
  }
  root.innerHTML = items.map(item => {
    const isUnread = !read.has(item.id);
    return `<article class="card nexus-announcement-card priority-${escapeHtml(item.priority || "normal")} ${item.pinned ? "pinned" : ""} ${isUnread ? "unread" : ""}" data-announcement-id="${escapeHtml(item.id)}">
      <div class="nexus-announcement-rail"><i></i></div>
      <div class="nexus-announcement-main">
        <header><div class="nexus-announcement-tags"><span>${escapeHtml(item.tenHocPhan || item.maHocPhan || "Học phần")}</span><b>${priorityLabel(item.priority)}</b>${item.pinned ? "<em>📌 Đã ghim</em>" : ""}${isUnread ? "<em>Mới</em>" : ""}</div><time>${fmtDate(item.updatedAt || item.createdAt)}</time></header>
        <h2>${escapeHtml(item.title || "Thông báo")}</h2>
        <p>${escapeHtml(item.content || "").replaceAll("\n", "<br>")}</p>
        <footer><span class="nexus-announcement-author"><i>${escapeHtml(initials(item.giaoVienTen))}</i><span><strong>${escapeHtml(item.giaoVienTen || "Giáo viên")}</strong><small>Giáo viên phụ trách</small></span></span>
          <div class="nexus-announcement-actions">
            ${state.role === "giaovien" ? `<button type="button" data-ann-edit="${escapeHtml(item.id)}">Sửa</button><button type="button" class="danger" data-ann-delete="${escapeHtml(item.id)}">Xóa</button>` : `<button type="button" data-ann-read="${escapeHtml(item.id)}">${isUnread ? "Đánh dấu đã đọc" : "Đã đọc ✓"}</button>`}
          </div>
        </footer>
      </div>
    </article>`;
  }).join("");
  root.querySelectorAll("[data-ann-read]").forEach(button => button.addEventListener("click", () => markAnnouncementRead(button.dataset.annRead)));
  root.querySelectorAll("[data-ann-edit]").forEach(button => button.addEventListener("click", () => editAnnouncement(button.dataset.annEdit)));
  root.querySelectorAll("[data-ann-delete]").forEach(button => button.addEventListener("click", () => removeAnnouncement(button.dataset.annDelete)));
}

function markAnnouncementRead(id) {
  const read = readAnnouncementIds();
  read.add(id);
  writeAnnouncementIds(read);
  renderAnnouncements();
  updateAnnouncementBadge();
}

function resetAnnouncementComposer() {
  state.announcementEditingId = null;
  $("announcement-composer-title").textContent = "Tạo thông báo mới";
  $("btn-save-announcement").querySelector("span").textContent = "Đăng thông báo";
  $("btn-cancel-announcement-edit").classList.add("hidden");
  $("announcement-title").value = "";
  $("announcement-content").value = "";
  $("announcement-priority").value = "normal";
  $("announcement-pinned").checked = false;
  updateAnnouncementCounter();
}

function editAnnouncement(id) {
  const item = state.announcements.find(entry => entry.id === id);
  if (!item) return;
  state.announcementEditingId = id;
  $("announcement-composer-title").textContent = "Chỉnh sửa thông báo";
  $("btn-save-announcement").querySelector("span").textContent = "Lưu thay đổi";
  $("btn-cancel-announcement-edit").classList.remove("hidden");
  $("announcement-course").value = item.hocPhanId || "";
  $("announcement-title").value = item.title || "";
  $("announcement-content").value = item.content || "";
  $("announcement-priority").value = item.priority || "normal";
  $("announcement-pinned").checked = Boolean(item.pinned);
  updateAnnouncementCounter();
  $("announcement-composer").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveAnnouncement() {
  if (!state.user || state.role !== "giaovien") return;
  const courseId = $("announcement-course").value;
  const title = $("announcement-title").value.trim();
  const content = $("announcement-content").value.trim();
  const priority = $("announcement-priority").value;
  const pinned = $("announcement-pinned").checked;
  if (!courseId || !title || !content) return toast("Vui lòng chọn học phần và nhập đủ tiêu đề, nội dung.", false);
  const course = state.courses.find(item => item.id === courseId);
  if (!course) return toast("Không tìm thấy học phần đã chọn.", false);
  const button = $("btn-save-announcement");
  button.disabled = true;
  try {
    const data = {
      hocPhanId: courseId,
      maHocPhan: course.maHocPhan || course.tenHocPhan || "",
      tenHocPhan: course.tenHocPhan || course.maHocPhan || "",
      giaoVienId: state.user.uid,
      giaoVienTen: state.profile.hoTen || core()?.currentUserName || state.user.email || "Giáo viên",
      title,
      content,
      priority,
      pinned,
      updatedAt: serverTimestamp()
    };
    if (state.announcementEditingId) {
      await updateDoc(doc(db, "thong_bao_hoc_phan", state.announcementEditingId), data);
      toast("Đã cập nhật thông báo.");
    } else {
      await addDoc(collection(db, "thong_bao_hoc_phan"), { ...data, createdAt: serverTimestamp() });
      toast("Đã phát thông báo tới học phần.");
    }
    resetAnnouncementComposer();
    state.announcements = [];
    await loadAnnouncements(true);
    renderAnnouncements();
  } catch (error) {
    toast("Không lưu được thông báo: " + (error.message || error), false);
  } finally {
    button.disabled = false;
  }
}

async function removeAnnouncement(id) {
  const item = state.announcements.find(entry => entry.id === id);
  if (!item || !confirm(`Xóa thông báo “${item.title}”?`)) return;
  try {
    await deleteDoc(doc(db, "thong_bao_hoc_phan", id));
    state.announcements = state.announcements.filter(entry => entry.id !== id);
    renderAnnouncements();
    updateAnnouncementBadge();
    toast("Đã xóa thông báo.");
  } catch (error) {
    toast("Không xóa được thông báo: " + (error.message || error), false);
  }
}

function updateAnnouncementCounter() {
  const length = $("announcement-content")?.value.length || 0;
  if ($("announcement-counter")) $("announcement-counter").textContent = `${length}/4000`;
}

async function loadAnnouncementsPage(force = false) {
  if (!state.user) return;
  setLoading("announcements", true);
  try {
    await Promise.all([loadBaseCourses(force), loadAnnouncements(force)]);
    $("announcement-composer").classList.toggle("hidden", state.role !== "giaovien");
    fillCourseSelects();
    renderAnnouncements();
  } finally {
    setLoading("announcements", false);
  }
}

async function loadTasks(force = false) {
  if (!state.user) return [];
  if (!force && state.tasks.length) return state.tasks;
  state.tasks = newestFirst(await safeDocs("ke_hoach_ca_nhan", [where("uid", "==", state.user.uid)]), "dueAt");
  return state.tasks;
}

function plannerEvents() {
  return buildSystemEvents();
}

function renderPlannerCalendar() {
  const root = $("planner-calendar-grid");
  if (!root) return;
  const month = state.plannerMonth;
  $("planner-month-label").textContent = month.toLocaleDateString("vi-VN", { month: "long", year: "numeric" });
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
  const totalCells = 42;
  const eventsByDate = new Map();
  plannerEvents().forEach(event => {
    const key = dateKey(event.date);
    if (!eventsByDate.has(key)) eventsByDate.set(key, []);
    eventsByDate.get(key).push(event);
  });
  root.innerHTML = Array.from({ length: totalCells }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = dateKey(date);
    const events = eventsByDate.get(key) || [];
    const outside = date < first || date > last;
    const today = key === dateKey(new Date());
    const selected = key === state.selectedPlannerDate;
    const dots = uniqueBy(events, event => event.type).slice(0, 3).map(event => `<i class="${event.type}" title="${escapeHtml(event.title)}"></i>`).join("");
    return `<button type="button" class="nexus-calendar-day ${outside ? "outside" : ""} ${today ? "today" : ""} ${selected ? "selected" : ""}" data-planner-date="${key}"><span>${date.getDate()}</span><div>${dots}</div>${events.length > 3 ? `<small>+${events.length - 3}</small>` : ""}</button>`;
  }).join("");
  root.querySelectorAll("[data-planner-date]").forEach(button => button.addEventListener("click", () => {
    state.selectedPlannerDate = button.dataset.plannerDate;
    renderPlannerCalendar();
    renderPlannerDayEvents();
  }));
}

function renderPlannerDayEvents() {
  const root = $("planner-day-events");
  if (!root) return;
  const selectedDate = new Date(`${state.selectedPlannerDate}T12:00:00`);
  $("planner-selected-date").textContent = selectedDate.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" });
  const items = plannerEvents().filter(event => dateKey(event.date) === state.selectedPlannerDate).sort((a, b) => a.date - b.date);
  if (!items.length) {
    root.innerHTML = `<div class="nexus-empty-state compact"><span>○</span><strong>Không có lịch</strong><small>Ngày này chưa có sự kiện hoặc nhiệm vụ.</small></div>`;
    return;
  }
  root.innerHTML = items.map(item => `<article class="${item.type}"><time>${item.date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</time><i></i><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.course)}</small></div></article>`).join("");
}

function filteredTasks() {
  const filter = $("planner-status-filter")?.value || "active";
  return state.tasks.filter(item => filter === "all" || (filter === "done" ? item.status === "done" : item.status !== "done"))
    .sort((a, b) => (valueToDate(a.dueAt)?.getTime() || Infinity) - (valueToDate(b.dueAt)?.getTime() || Infinity));
}

function renderTaskList() {
  const root = $("planner-task-list");
  if (!root) return;
  const tasks = filteredTasks();
  if (!tasks.length) {
    root.innerHTML = `<div class="nexus-empty-state"><span>✓</span><strong>${$("planner-status-filter")?.value === "done" ? "Chưa có nhiệm vụ hoàn thành" : "Danh sách công việc trống"}</strong><small>Thêm nhiệm vụ cá nhân để lập kế hoạch học tập rõ ràng hơn.</small></div>`;
    return;
  }
  root.innerHTML = tasks.map(item => {
    const due = valueToDate(item.dueAt);
    const overdue = item.status !== "done" && due && due.getTime() < Date.now();
    return `<article class="nexus-task-row priority-${escapeHtml(item.priority || "normal")} ${item.status === "done" ? "done" : ""} ${overdue ? "overdue" : ""}">
      <button type="button" class="nexus-task-check" data-task-toggle="${escapeHtml(item.id)}" aria-label="Đổi trạng thái nhiệm vụ">${item.status === "done" ? "✓" : ""}</button>
      <div class="nexus-task-copy"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.description || "Không có ghi chú")}</p><small>${overdue ? "Quá hạn · " : ""}${fmtDate(item.dueAt)} · ${priorityLabel(item.priority)}</small></div>
      <button type="button" class="nexus-task-delete" data-task-delete="${escapeHtml(item.id)}" aria-label="Xóa nhiệm vụ">✕</button>
    </article>`;
  }).join("");
  root.querySelectorAll("[data-task-toggle]").forEach(button => button.addEventListener("click", () => toggleTask(button.dataset.taskToggle)));
  root.querySelectorAll("[data-task-delete]").forEach(button => button.addEventListener("click", () => removeTask(button.dataset.taskDelete)));
}

async function addPlannerTask() {
  if (!state.user) return;
  const title = $("planner-task-title").value.trim();
  const description = $("planner-task-description").value.trim();
  const dueText = $("planner-task-due").value;
  const priority = $("planner-task-priority").value;
  const due = dueText ? new Date(dueText) : null;
  if (!title || !due || Number.isNaN(due.getTime())) return toast("Nhập tiêu đề và hạn hoàn thành hợp lệ.", false);
  const button = $("btn-add-planner-task");
  button.disabled = true;
  try {
    await addDoc(collection(db, "ke_hoach_ca_nhan"), {
      uid: state.user.uid,
      title,
      description,
      dueAt: Timestamp.fromDate(due),
      priority,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    $("planner-task-title").value = "";
    $("planner-task-description").value = "";
    setDefaultTaskDue();
    state.tasks = [];
    await loadTasks(true);
    renderPlanner();
    toast("Đã thêm nhiệm vụ vào kế hoạch.");
  } catch (error) {
    toast("Không thêm được nhiệm vụ: " + (error.message || error), false);
  } finally {
    button.disabled = false;
  }
}

async function toggleTask(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  const next = task.status === "done" ? "active" : "done";
  try {
    await updateDoc(doc(db, "ke_hoach_ca_nhan", id), { status: next, completedAt: next === "done" ? serverTimestamp() : null, updatedAt: serverTimestamp() });
    task.status = next;
    renderPlanner();
  } catch (error) {
    toast("Không cập nhật được nhiệm vụ: " + (error.message || error), false);
  }
}

async function removeTask(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task || !confirm(`Xóa nhiệm vụ “${task.title}”?`)) return;
  try {
    await deleteDoc(doc(db, "ke_hoach_ca_nhan", id));
    state.tasks = state.tasks.filter(item => item.id !== id);
    renderPlanner();
    toast("Đã xóa nhiệm vụ.");
  } catch (error) {
    toast("Không xóa được nhiệm vụ: " + (error.message || error), false);
  }
}

function setDefaultTaskDue() {
  if (!$("planner-task-due") || $("planner-task-due").value) return;
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(20, 0, 0, 0);
  $("planner-task-due").value = toLocalDateTimeValue(date);
}

function renderPlanner() {
  renderPlannerCalendar();
  renderPlannerDayEvents();
  renderTaskList();
}

async function loadPlannerPage(force = false) {
  if (!state.user) return;
  setLoading("planner", true);
  try {
    await Promise.all([loadLearningData(force), loadTasks(force)]);
    setDefaultTaskDue();
    renderPlanner();
  } finally {
    setLoading("planner", false);
  }
}

function applyReducedMotion(value) {
  document.documentElement.classList.toggle("reduced-motion", Boolean(value));
  try { localStorage.setItem("examflow-reduced-motion", value ? "1" : "0"); } catch {}
}

function applyGameSound(value) {
  try { localStorage.setItem("examflow-game-sound", value ? "1" : "0"); } catch {}
  const soundButton = $("btn-quiz-sound");
  if (soundButton) {
    soundButton.dataset.preferredSound = value ? "1" : "0";
    soundButton.textContent = value ? "🔊" : "🔇";
  }
}

function updateThemeButtons() {
  const stored = localStorage.getItem("app-theme-preference") || localStorage.getItem("app-theme") || "system";
  document.querySelectorAll("[data-theme-choice]").forEach(button => button.classList.toggle("active", button.dataset.themeChoice === stored));
}

function chooseTheme(choice) {
  try { localStorage.setItem("app-theme-preference", choice); } catch {}
  const resolved = choice === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : choice;
  core()?.applyTheme?.(resolved);
  updateThemeButtons();
  setSettingsSaveState("Đã cập nhật giao diện");
}

function renderSettings() {
  const name = state.profile.hoTen || core()?.currentUserName || state.user?.displayName || "";
  $("settings-full-name").value = name;
  $("settings-user-code").value = state.profile.maSo || "";
  $("settings-email").value = state.user?.email || "";
  $("settings-role").value = roleLabel(state.role);
  $("settings-profile-avatar").textContent = initials(name);
  const reduced = localStorage.getItem("examflow-reduced-motion") === "1";
  const sound = localStorage.getItem("examflow-game-sound") !== "0";
  $("settings-reduced-motion").checked = reduced;
  $("settings-game-sound").checked = sound;
  applyReducedMotion(reduced);
  applyGameSound(sound);
  updateThemeButtons();
}

async function saveProfileSettings() {
  if (!state.user) return;
  const hoTen = $("settings-full-name").value.trim();
  const maSo = $("settings-user-code").value.trim();
  if (!hoTen) return toast("Họ và tên không được để trống.", false);
  const button = $("btn-save-profile-settings");
  button.disabled = true;
  setSettingsSaveState("Đang lưu thay đổi...", "loading");
  try {
    await updateDoc(doc(db, "users", state.user.uid), { hoTen, hoTenKey: normalize(hoTen), maSo, updatedAt: serverTimestamp() });
    await setDoc(doc(db, "danh_ba_cong_khai", state.user.uid), { uid: state.user.uid, hoTen, hoTenKey: normalize(hoTen), role: state.role, updatedAt: serverTimestamp() }, { merge: true });
    await updateProfile(state.user, { displayName: hoTen }).catch(() => {});
    state.profile = { ...state.profile, hoTen, maSo };
    try {
      localStorage.setItem(`examflow-profile:${state.user.uid}`, JSON.stringify({ role: state.role, hoTen, maSo, cachedAt: Date.now() }));
    } catch {}
    $("settings-profile-avatar").textContent = initials(hoTen);
    if ($("topbar-user-name")) $("topbar-user-name").textContent = hoTen;
    if ($("sb-name")) $("sb-name").textContent = hoTen;
    setSettingsSaveState("Mọi thay đổi đã được lưu");
    toast("Đã cập nhật hồ sơ cá nhân.");
  } catch (error) {
    setSettingsSaveState("Không thể lưu hồ sơ", "error");
    toast("Không lưu được hồ sơ: " + (error.message || error), false);
  } finally {
    button.disabled = false;
  }
}

async function testFirebaseConnection() {
  const result = $("settings-diagnostic-result");
  result.classList.remove("hidden", "ok", "error");
  result.innerHTML = "<span>⌛</span><div><strong>Đang kiểm tra kết nối...</strong><small>Đọc hồ sơ người dùng từ Firestore.</small></div>";
  const started = performance.now();
  try {
    const snap = await withTimeout(getDoc(doc(db, "users", state.user.uid)), 12000);
    const elapsed = Math.round(performance.now() - started);
    result.classList.add("ok");
    result.innerHTML = `<span>✓</span><div><strong>Firebase hoạt động bình thường</strong><small>Phản hồi trong ${elapsed} ms · Hồ sơ ${snap.exists() ? "đã tồn tại" : "chưa tồn tại"}.</small></div>`;
  } catch (error) {
    result.classList.add("error");
    result.innerHTML = `<span>!</span><div><strong>Không truy cập được Firebase</strong><small>${escapeHtml(error.message || String(error))}</small></div>`;
  }
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportNexusData() {
  await Promise.all([loadTasks(false), loadAnnouncements(false)]);
  downloadJson(`examflow-data-${dateKey(new Date())}.json`, {
    exportedAt: new Date().toISOString(),
    account: { uid: state.user.uid, email: state.user.email, role: state.role, profile: state.profile },
    preferences: {
      theme: localStorage.getItem("app-theme-preference") || localStorage.getItem("app-theme") || "system",
      reducedMotion: localStorage.getItem("examflow-reduced-motion") === "1",
      gameSound: localStorage.getItem("examflow-game-sound") !== "0"
    },
    personalTasks: state.tasks,
    announcementsVisible: state.announcements.map(item => ({ ...item, createdAt: valueToDate(item.createdAt)?.toISOString() || null, updatedAt: valueToDate(item.updatedAt)?.toISOString() || null }))
  });
  toast("Đã xuất dữ liệu cá nhân thành tệp JSON.");
}

function clearNexusCache() {
  if (!confirm("Xóa bộ nhớ giao diện trên máy này? Dữ liệu Firebase và bài đã nộp sẽ không bị xóa.")) return;
  const keep = new Set(["app-theme", "app-theme-preference"]);
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  keys.filter(key => key && !keep.has(key) && key.startsWith("examflow")).forEach(key => localStorage.removeItem(key));
  state.dashboardLoadedAt = 0;
  state.tasks = [];
  state.announcements = [];
  toast("Đã xóa bộ nhớ giao diện cục bộ.");
}

async function loadSettingsPage() {
  if (!state.user) return;
  if (!Object.keys(state.profile).length) await loadProfile();
  renderSettings();
}

function route(pageId) {
  if (!NEXUS_PAGES.has(pageId)) return;
  const now = performance.now();
  if (state.lastRoutePage === pageId && now - state.lastRouteAt < 250) return;
  state.lastRoutePage = pageId;
  state.lastRouteAt = now;
  if (pageId === "page-dashboard") loadDashboard(false);
  if (pageId === "page-announcements") loadAnnouncementsPage(false);
  if (pageId === "page-planner") loadPlannerPage(false);
  if (pageId === "page-settings") loadSettingsPage();
}

function bindRouteButtons(root = document) {
  root?.querySelectorAll?.("[data-nexus-route]").forEach(button => {
    if (button.dataset.nexusBound === "1") return;
    button.dataset.nexusBound = "1";
    button.addEventListener("click", () => {
      const pageId = button.dataset.nexusRoute;
      const nav = document.querySelector(`.nav-item[data-page="${pageId}"]`);
      if (nav) nav.click();
      else {
        core()?.setPage?.(pageId);
        route(pageId);
      }
    });
  });
}

function attachStaticEvents() {
  bindRouteButtons(document);
  $("btn-refresh-nexus-dashboard")?.addEventListener("click", () => loadDashboard(true));
  $("nexus-chart-range")?.addEventListener("change", drawPerformanceChart);
  window.addEventListener("resize", debounce(() => {
    if (currentRoute() === "page-dashboard") drawPerformanceChart();
  }, 180));

  $("announcement-content")?.addEventListener("input", updateAnnouncementCounter);
  $("announcement-search")?.addEventListener("input", renderAnnouncements);
  $("announcement-course-filter")?.addEventListener("change", renderAnnouncements);
  $("announcement-priority-filter")?.addEventListener("change", renderAnnouncements);
  $("btn-save-announcement")?.addEventListener("click", saveAnnouncement);
  $("btn-cancel-announcement-edit")?.addEventListener("click", resetAnnouncementComposer);
  $("btn-refresh-announcements")?.addEventListener("click", () => loadAnnouncementsPage(true));

  $("btn-planner-prev")?.addEventListener("click", () => {
    state.plannerMonth = new Date(state.plannerMonth.getFullYear(), state.plannerMonth.getMonth() - 1, 1);
    renderPlannerCalendar();
  });
  $("btn-planner-next")?.addEventListener("click", () => {
    state.plannerMonth = new Date(state.plannerMonth.getFullYear(), state.plannerMonth.getMonth() + 1, 1);
    renderPlannerCalendar();
  });
  $("btn-planner-today")?.addEventListener("click", () => {
    state.plannerMonth = startOfMonth(new Date());
    state.selectedPlannerDate = dateKey(new Date());
    renderPlanner();
  });
  $("btn-add-planner-task")?.addEventListener("click", addPlannerTask);
  $("planner-status-filter")?.addEventListener("change", renderTaskList);
  $("btn-refresh-planner")?.addEventListener("click", () => loadPlannerPage(true));

  $("btn-save-profile-settings")?.addEventListener("click", saveProfileSettings);
  $("profile-settings-action")?.addEventListener("click", () => {
    const nav = document.querySelector('.nav-item[data-page="page-settings"]');
    if (nav) nav.click();
    else { core()?.setPage?.("page-settings"); route("page-settings"); }
    $("profile-popover")?.classList.add("hidden");
  });
  document.querySelectorAll("[data-theme-choice]").forEach(button => button.addEventListener("click", () => chooseTheme(button.dataset.themeChoice)));
  $("settings-reduced-motion")?.addEventListener("change", event => {
    applyReducedMotion(event.target.checked);
    setSettingsSaveState("Đã cập nhật chuyển động");
  });
  $("settings-game-sound")?.addEventListener("change", event => {
    applyGameSound(event.target.checked);
    setSettingsSaveState("Đã cập nhật âm thanh");
  });
  $("btn-toggle-sidebar-setting")?.addEventListener("click", () => $("btn-sidebar-toggle")?.click());
  $("btn-test-firebase")?.addEventListener("click", testFirebaseConnection);
  $("btn-export-nexus-data")?.addEventListener("click", exportNexusData);
  $("btn-clear-nexus-cache")?.addEventListener("click", clearNexusCache);

  document.addEventListener("examflow:page-change", event => route(event.detail?.pageId));
  document.addEventListener("examflow:workspace-opened", () => {
    setTimeout(() => route(currentRoute() || "page-dashboard"), 0);
  });

  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    if ((localStorage.getItem("app-theme-preference") || "system") === "system") chooseTheme("system");
  });
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function resetStateForLogout() {
  state.user = null;
  state.role = null;
  state.profile = {};
  state.courses = [];
  state.enrollments = [];
  state.exams = [];
  state.quizzes = [];
  state.meetings = [];
  state.submissions = [];
  state.quizAttempts = [];
  state.announcements = [];
  state.tasks = [];
  state.dashboardLoadedAt = 0;
  state.announcementEditingId = null;
}

async function initializeUser(user) {
  const sequence = ++state.authSequence;
  state.user = user;
  await loadProfile();
  if (sequence !== state.authSequence || auth.currentUser?.uid !== user.uid) return;
  const themePreference = localStorage.getItem("app-theme-preference");
  if (themePreference === "system") chooseTheme("system");
  else if (themePreference === "light" || themePreference === "dark") chooseTheme(themePreference);
  const reduced = localStorage.getItem("examflow-reduced-motion") === "1";
  applyReducedMotion(reduced);
  applyGameSound(localStorage.getItem("examflow-game-sound") !== "0");
  setTimeout(() => route(currentRoute() || "page-dashboard"), 0);
}

attachStaticEvents();

onAuthStateChanged(auth, user => {
  if (user) initializeUser(user).catch(error => console.error("Nexus user init failed:", error));
  else {
    state.authSequence += 1;
    resetStateForLogout();
  }
});

window.ExamFlowUpgrade = Object.freeze({
  route,
  loadDashboard,
  loadAnnouncements: loadAnnouncementsPage,
  loadPlanner: loadPlannerPage,
  loadSettings: loadSettingsPage,
  refreshAll: async () => {
    state.dashboardLoadedAt = 0;
    state.courses = [];
    state.announcements = [];
    state.tasks = [];
    await loadDashboard(true);
  },
  getState: () => ({
    role: state.role,
    courseCount: state.courses.length,
    announcementCount: state.announcements.length,
    taskCount: state.tasks.length,
    dashboardLoadedAt: state.dashboardLoadedAt
  })
});

window.dispatchEvent(new CustomEvent("examflow:nexus-ready"));
