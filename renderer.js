import { initializeApp }          from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signOut, onAuthStateChanged, updateProfile }
  from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc,
         doc, setDoc, getDoc, updateDoc, query, orderBy, where, limit,
         onSnapshot, serverTimestamp, Timestamp, arrayUnion, arrayRemove }
  from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject }
  from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const fbApp   = initializeApp(firebaseConfig);
const auth    = getAuth(fbApp);
const db      = getFirestore(fbApp);
const storage = getStorage(fbApp);

const isConfigured = firebaseConfig.apiKey !== "PASTE_YOUR_API_KEY_HERE";
if (!isConfigured) document.getElementById("cfg-warn").classList.remove("hidden");
document.getElementById("cfg-warn-close").onclick = () =>
  document.getElementById("cfg-warn").classList.add("hidden");

const $    = id => document.getElementById(id);
const show = id => $(id).classList.remove("hidden");
const hide = id => $(id).classList.add("hidden");

function toast(msg, ok = true) {
  const t = $("toast");
  if (!t) return;
  t.replaceChildren();

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.textContent = ok ? "✓" : "!";

  const copy = document.createElement("span");
  copy.className = "toast-copy";
  copy.textContent = msg;

  const progress = document.createElement("span");
  progress.className = "toast-progress";

  t.append(icon, copy, progress);
  t.className = "toast " + (ok ? "ok" : "err");
  t.classList.remove("hidden");
  clearTimeout(t._t);
  // Khởi động lại animation thanh thời gian cho các thông báo liên tiếp.
  progress.style.animation = "none";
  requestAnimationFrame(() => { progress.style.animation = "toastCountdown 4.2s linear forwards"; });
  t._t = setTimeout(() => t.classList.add("hidden"), 4200);
}

function setLoading(btnId, on, label = "Đang xử lý…") {
  const b = $(btnId);
  if (!b) return;

  if (on) {
    if (!b.dataset.origHtml) b.dataset.origHtml = b.innerHTML;
    b.disabled = true;
    b.classList.add("is-loading");
    b.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
    return;
  }

  b.disabled = false;
  b.classList.remove("is-loading");
  b.innerHTML = b.dataset.origHtml || (btnId === "btn-login" ? "Đăng nhập" : "Tạo tài khoản");
  delete b.dataset.origHtml;
}

function withTimeout(promise, ms = 20000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Kết nối Firebase quá thời gian chờ.");
      error.code = "auth/network-timeout";
      reject(error);
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function fmtDate(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date();
  return d.toLocaleString("vi-VN");
}

function timestampMs(ts) {
  if (ts?.toMillis) return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function newestFirst(list) {
  return [...list].sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatScore(score) {
  if (score === null || score === undefined || score === "") return "Chưa chấm";
  const number = Number(score);
  return Number.isFinite(number) ? number.toLocaleString("vi-VN") : "Chưa chấm";
}

function valueToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtOptionalDate(value) {
  const date = valueToDate(value);
  return date ? date.toLocaleString("vi-VN") : "—";
}

function toDateTimeLocalValue(value) {
  const date = valueToDate(value);
  if (!date) return "";

  const pad = number => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes())
  ].join("");
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60000);
  if (totalMinutes < 1) return "dưới 1 phút";

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days) parts.push(`${days} ngày`);
  if (hours) parts.push(`${hours} giờ`);
  if (minutes && parts.length < 2) parts.push(`${minutes} phút`);

  return parts.join(" ");
}

function getDeadlineStatus(deadlineValue, now = new Date()) {
  const deadline = valueToDate(deadlineValue);

  if (!deadline) {
    return {
      hasDeadline: false,
      expired: false,
      label: "Không giới hạn",
      detail: "Đề thi chưa đặt hạn nộp."
    };
  }

  const difference = deadline.getTime() - now.getTime();

  if (difference >= 0) {
    return {
      hasDeadline: true,
      expired: false,
      label: "Còn hạn",
      detail: `Còn ${formatDuration(difference)}`
    };
  }

  return {
    hasDeadline: true,
    expired: true,
    label: "Đã quá hạn",
    detail: `Quá hạn ${formatDuration(Math.abs(difference))}`
  };
}

function getSubmissionLateInfo(submission, exam = null) {
  const submittedAt = valueToDate(
    submission?.submittedAtClient || submission?.createdAt
  );
  const deadline = valueToDate(
    exam?.deadlineAt || submission?.deadlineAtSnapshot
  );

  if (!submittedAt || !deadline) {
    return {
      isLate: Boolean(submission?.isLate),
      lateByMs: Number(submission?.lateByMs || 0),
      label: submission?.lateLabel ||
        (submission?.isLate ? "Nộp muộn" : "Không xác định hạn")
    };
  }

  const lateByMs = submittedAt.getTime() - deadline.getTime();

  if (lateByMs > 0) {
    return {
      isLate: true,
      lateByMs,
      label: `Nộp muộn ${formatDuration(lateByMs)}`
    };
  }

  return {
    isLate: false,
    lateByMs: 0,
    label: "Đúng hạn"
  };
}

function examDisplayName(exam) {
  return exam?.moTa?.trim() || exam?.tenFile || "Đề thi";
}

function normalizeCourseName(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function courseLabel(item) {
  const ma = (item?.maHocPhan || "").trim();
  const ten = (item?.tenHocPhan || "").trim();
  if (!ma) return ten || "—";
  if (!ten || normalizeCourseName(ma) === normalizeCourseName(ten)) return ma;
  return `${ma} — ${ten}`;
}

async function findCourseByNameOrOldCode(value) {
  const key = normalizeCourseName(value);
  if (!key) return null;

  // Lấy danh sách rồi so sánh trong JavaScript để:
  // - không phân biệt hoa/thường;
  // - chấp nhận tên có hoặc không dấu;
  // - vẫn dùng được học phần cũ có mã dạng HPxxxx.
  const snap = await getDocs(collection(db, "hoc_phan"));
  return snap.docs.find(courseDoc => {
    const hp = courseDoc.data();
    return [
      hp.maHocPhanKey,
      hp.maHocPhan,
      hp.tenHocPhan
    ].some(candidate => normalizeCourseName(candidate) === key);
  }) || null;
}

async function hashPw(pw) {
  const enc = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Đã sao chép mã: " + text); }
  catch { toast("Không thể sao chép.", false); }
}
window._copyMaHP = copyText;

/* ── Giao diện ứng dụng ─────────────────────────────────────── */
const PAGE_META = {
  "page-admin":             ["Quản trị hệ thống", "Quản lý người dùng và giao diện toàn website"],
  "page-dashboard":         ["Tổng quan", "Trung tâm điều hành và tiến độ theo thời gian thực"],
  "page-announcements":     ["Bảng tin", "Thông báo và cập nhật quan trọng theo học phần"],
  "page-planner":           ["Lịch & công việc", "Theo dõi hạn nộp, lịch học và nhiệm vụ cá nhân"],
  "page-settings":          ["Hồ sơ & cài đặt", "Quản lý thông tin cá nhân và trải nghiệm ứng dụng"],
  "page-hoc-phan":         ["Học phần", "Tạo và quản lý các học phần của bạn"],
  "page-dang-de":          ["Đăng đề thi", "Tải đề lên và thiết lập hạn nộp"],
  "page-ds-de":            ["Danh sách đề", "Theo dõi và quản lý các đề đã đăng"],
  "page-bai-nop":          ["Bài nộp", "Xem, tải xuống và chấm bài của học sinh"],
  "page-ghi-danh":         ["Ghi danh học phần", "Tham gia học phần bằng tên và mật khẩu"],
  "page-tai-de":           ["Tải đề thi", "Xem các đề đang có trong học phần"],
  "page-nop-bai":          ["Nộp bài", "Gửi bài làm và theo dõi trạng thái hạn nộp"],
  "page-ket-qua":          ["Điểm của tôi", "Xem điểm số và nhận xét từ giáo viên"],
  "page-lop-truc-tuyen":   ["Lớp học trực tuyến", "Lên lịch hoặc tham gia buổi học trực tuyến"],
  "page-phong-hop":        ["Phòng học trực tuyến", "Bạn đang tham gia một buổi học"],
  "page-trac-nghiem-gv":   ["Trắc nghiệm", "Tạo đề, quản lý lượt làm và xem kết quả"],
  "page-trac-nghiem-hs":   ["Trắc nghiệm", "Làm bài và xem kết quả trắc nghiệm"],
  "page-ban-be":            ["Tin nhắn & Nhóm lớp", "Trò chuyện riêng tư và trao đổi cùng cả lớp"]
};

function normalizeSystemRole(role) {
  return role === "admin" || role === "giaovien" || role === "hocsinh" ? role : "hocsinh";
}

function systemRoleLabel(role) {
  return role === "admin" ? "Quản trị viên" : role === "giaovien" ? "Giáo viên" : "Học sinh";
}

function updateTopbarPage(pageId) {
  const meta = PAGE_META[pageId] || ["Không gian học tập", "Quản lý công việc của bạn"];
  if ($("topbar-page-label")) $("topbar-page-label").textContent = meta[0];
  if ($("topbar-page-hint"))  $("topbar-page-hint").textContent  = meta[1];
}

function refreshTopbarDate() {
  if (!$("topbar-date")) return;
  const now = new Date();
  $("topbar-date").textContent = now.toLocaleDateString("vi-VN", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "numeric"
  });
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  try { localStorage.setItem("app-theme", nextTheme); } catch {}

  const icon = nextTheme === "dark" ? "☀️" : "🌙";
  const label = nextTheme === "dark" ? "Chế độ sáng" : "Chế độ tối";
  if ($("sidebar-theme-icon"))  $("sidebar-theme-icon").textContent = icon;
  if ($("sidebar-theme-label")) $("sidebar-theme-label").textContent = label;
  if ($("btn-top-theme"))       $("btn-top-theme").textContent = icon;
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function closeMobileSidebar() {
  document.body.classList.remove("sidebar-open");
}

(function initApplicationShell() {
  let savedTheme = "";
  try { savedTheme = localStorage.getItem("app-theme") || ""; } catch {}
  const preferredTheme = savedTheme ||
    (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(preferredTheme);

  let sidebarCollapsed = false;
  try { sidebarCollapsed = localStorage.getItem("sidebar-collapsed") === "1"; } catch {}
  document.body.classList.toggle("sidebar-collapsed", sidebarCollapsed);

  $("btn-sidebar-toggle")?.addEventListener("click", () => {
    const collapsed = !document.body.classList.contains("sidebar-collapsed");
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    try { localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0"); } catch {}
    $("btn-sidebar-toggle").textContent = collapsed ? "›" : "‹";
    $("btn-sidebar-toggle").title = collapsed ? "Mở rộng thanh menu" : "Thu gọn thanh menu";
  });

  if (sidebarCollapsed && $("btn-sidebar-toggle")) {
    $("btn-sidebar-toggle").textContent = "›";
    $("btn-sidebar-toggle").title = "Mở rộng thanh menu";
  }

  $("btn-mobile-menu")?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });
  $("sidebar-backdrop")?.addEventListener("click", closeMobileSidebar);
  $("btn-theme-toggle")?.addEventListener("click", toggleTheme);
  $("btn-top-theme")?.addEventListener("click", toggleTheme);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMobileSidebar();
  });

  refreshTopbarDate();
  setInterval(refreshTopbarDate, 60000);
})();

function setScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const sc = $(name);
  sc.classList.remove("hidden");
  sc.classList.add("active");
}

function setPage(id) {
  if (id !== "page-ban-be") {
    if (socialSelectedFriend) closeSocialChat();
    if (selectedClassGroup) closeClassGroupChat();
  }
  document.querySelectorAll(".page").forEach(p => {
    p.classList.remove("active");
    p.classList.add("hidden");   // style.css dùng .hidden { display:none !important }
  });

  const pg = $(id);
  if (!pg) return;
  pg.classList.remove("hidden");
  pg.classList.add("active");
  pg.scrollTop = 0;

  document.querySelectorAll(".nav-item").forEach(n => {
    const active = n.dataset.page === id;
    n.classList.toggle("active", active);
    n.setAttribute("aria-current", active ? "page" : "false");
  });

  updateTopbarPage(id);
  ensurePremiumPageHero(id);
  updatePremiumPageMetrics(id);
  closeMobileSidebar();
  document.dispatchEvent(new CustomEvent("examflow:page-change", { detail: { pageId: id } }));
}

$("btn-register").onclick = async () => {
  const hoTen = $("reg-hoten").value.trim();
  const maSo  = $("reg-maso").value.trim();
  const email = $("reg-email").value.trim();
  const pw    = $("reg-pw").value;
  const pw2   = $("reg-pw2").value;
  const role  = document.querySelector('input[name="role"]:checked')?.value;

  if (!hoTen || !email || !pw || !role) { toast("Vui lòng điền đủ thông tin (*)", false); return; }
  if (pw !== pw2)    { toast("Mật khẩu xác nhận không khớp.", false); return; }
  if (pw.length < 6) { toast("Mật khẩu phải có ít nhất 6 ký tự.", false); return; }

  setLoading("btn-register", true);
  try {
    const cred = await withTimeout(createUserWithEmailAndPassword(auth, email, pw));
    await withTimeout(setDoc(doc(db, "users", cred.user.uid), {
      hoTen, hoTenKey: normalizeCourseName(hoTen), maSo, email, role, createdAt: serverTimestamp()
    }));
    try {
      await withTimeout(setDoc(doc(db, "danh_ba_cong_khai", cred.user.uid), {
        uid: cred.user.uid,
        hoTen,
        hoTenKey: normalizeCourseName(hoTen),
        role,
        updatedAt: serverTimestamp()
      }, { merge: true }));
    } catch (profileError) {
      console.warn("Chưa tạo được hồ sơ công khai; ứng dụng sẽ thử lại khi đăng nhập:", profileError);
    }
    toast("Đăng ký thành công! Chào mừng " + hoTen);
  } catch (e) {
    console.error("Register error:", e);
    toast(errMsg(e.code, e.message), false);
  } finally {
    setLoading("btn-register", false);
  }
};

$("btn-login").onclick = async () => {
  const email = $("login-email").value.trim();
  const pw    = $("login-pw").value;
  if (!email || !pw) { toast("Nhập email và mật khẩu.", false); return; }

  setLoading("btn-login", true, "Đang xác thực…");
  try {
    await withTimeout(signInWithEmailAndPassword(auth, email, pw), 12000);

    // onAuthStateChanged sẽ mở giao diện và tự tắt loading. Không bật lại nút
    // quá sớm vì người dùng sẽ có cảm giác đăng nhập bị đứng hoặc phải bấm lại.
    if ($("screen-auth")?.classList.contains("active")) {
      setLoading("btn-login", true, "Đang mở ứng dụng…");
    }
  } catch (e) {
    console.error("Login error:", e);
    toast(errMsg(e.code, e.message), false);
    setLoading("btn-login", false);
  }
};

[$("login-email"), $("login-pw")].forEach(el =>
  el.addEventListener("keydown", e => { if (e.key === "Enter") $("btn-login").click(); })
);

$("btn-logout").onclick = () => signOut(auth);

let currentUser = null;
let currentRole = null;
let currentUserName = null;
let teacherHocPhanList = [];   // học phần do giáo viên hiện tại tạo
let studentHocPhanList = [];   // học phần học sinh hiện tại đã ghi danh
let allStudentExams = [];
let allTeacherExams = [];
let submissionExamList = [];
let allStudentResults = [];
let allStudentScoreRecords = [];
let studentScoreExamMap = new Map();
let activeStudentScoreRecords = [];
let activeScoreChartMode = "distribution";
let scoreChartResizeTimer = null;
let teacherExamMap = new Map();
let selectedDeadlineExamId = null;

// Lớp học trực tuyến
let allOnlineMeetings = [];
let visibleOnlineMeetings = [];
let activeOnlineMeeting = null;
let jitsiApi = null;
let meetingClockTimer = null;
let isClosingJitsi = false;

// Bạn bè và nhắn tin
let socialFriendships = [];
let socialConversations = new Map();
let socialPublicProfiles = new Map();
let socialSelectedFriend = null;
let socialFriendshipUnsubscribe = null;
let socialConversationUnsubscribe = null;
let socialMessagesUnsubscribe = null;
let socialPendingCount = 0;
let socialUnreadCount = 0;
let socialSearchTimer = null;
let socialInitializedUid = null;

// Nhóm chat lớp theo học phần
let classGroups = [];
let selectedClassGroup = null;
let classGroupUnsubscribe = null;
let classGroupMessagesUnsubscribe = null;
let classGroupUnreadCount = 0;
let activeSocialMode = "private";
let classGroupsSyncPromise = null;

const selectedFiles = { de: null, bai: null };

// Tối ưu luồng đăng nhập: dùng hồ sơ đã lưu để mở giao diện ngay, sau đó
// đồng bộ lại Firestore ở nền. Cache chỉ chứa tên/vai trò, không chứa mật khẩu.
const PROFILE_CACHE_PREFIX = "examflow-profile:";
const PROFILE_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
let openedWorkspaceUid = null;
let authStateSequence = 0;
let scheduledSocialInit = null;

function readCachedProfile(uid) {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_PREFIX + uid);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.role || !cached?.hoTen) return null;
    if (Date.now() - Number(cached.cachedAt || 0) > PROFILE_CACHE_MAX_AGE) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCachedProfile(uid, data = {}) {
  if (!uid || !data?.role || !data?.hoTen) return;
  try {
    localStorage.setItem(PROFILE_CACHE_PREFIX + uid, JSON.stringify({
      hoTen: data.hoTen,
      role: data.role,
      maSo: data.maSo || "",
      cachedAt: Date.now()
    }));
  } catch {}
}

function cancelScheduledSocialInitialization() {
  if (!scheduledSocialInit) return;
  if (scheduledSocialInit.type === "idle" && window.cancelIdleCallback) {
    window.cancelIdleCallback(scheduledSocialInit.id);
  } else {
    clearTimeout(scheduledSocialInit.id);
  }
  scheduledSocialInit = null;
}

function scheduleSocialInitialization(userData = {}) {
  cancelScheduledSocialInitialization();
  const run = () => {
    scheduledSocialInit = null;
    initializeSocialForUser(userData).catch(error => {
      console.error("Không thể khởi tạo tính năng bạn bè:", error);
      if (error?.code === "permission-denied" || error?.code === "firestore/permission-denied") {
        toast("Bạn bè & Tin nhắn cần cập nhật Firestore Rules trước khi sử dụng.", false);
      }
    });
  };

  if (window.requestIdleCallback) {
    scheduledSocialInit = {
      type: "idle",
      id: window.requestIdleCallback(run, { timeout: 1400 })
    };
  } else {
    scheduledSocialInit = { type: "timeout", id: setTimeout(run, 650) };
  }
}

function applyAuthenticatedProfile(user, data = {}) {
  currentUser = user;
  currentRole = normalizeSystemRole(data.role);
  currentUserName = data.hoTen || user.displayName || user.email || "Người dùng";

  const initials = currentUserName
    .split(" ")
    .filter(Boolean)
    .map(word => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  $("sb-avatar").textContent = initials || "?";
  $("sb-name").textContent = currentUserName;
  $("sb-role").textContent = systemRoleLabel(currentRole);
  if ($("topbar-avatar"))          $("topbar-avatar").textContent = initials || "?";
  if ($("topbar-user-name"))       $("topbar-user-name").textContent = currentUserName;
  if ($("topbar-user-role"))       $("topbar-user-role").textContent = systemRoleLabel(currentRole);
  if ($("profile-popover-avatar")) $("profile-popover-avatar").textContent = initials || "?";
  if ($("profile-popover-name"))   $("profile-popover-name").textContent = currentUserName;
  if ($("profile-popover-email"))  $("profile-popover-email").textContent = user.email || "—";

  document.body.classList.toggle("role-student", currentRole === "hocsinh");
  document.body.classList.toggle("role-teacher", currentRole === "giaovien");
  document.body.classList.toggle("role-admin", currentRole === "admin");
  if ($("topbar-role-label")) {
    $("topbar-role-label").textContent = currentRole === "admin"
      ? "Không gian quản trị viên"
      : currentRole === "giaovien"
        ? "Không gian giáo viên"
        : "Không gian học sinh";
  }
  renderPremiumNotifications();
}

function openAuthenticatedWorkspace(user, data = {}) {
  applyAuthenticatedProfile(user, data);

  if (openedWorkspaceUid === user.uid) return;
  openedWorkspaceUid = user.uid;

  buildNav(currentRole);
  document.body.classList.add("app-entering");
  setScreen("screen-app");
  show("sidebar");
  setTimeout(() => document.body.classList.remove("app-entering"), 650);

  setPage(currentRole === "admin" ? "page-admin" : "page-dashboard");
  if (currentRole === "giaovien") {
    loadHocPhan_GV();
  } else if (currentRole === "hocsinh") {
    $("stat-hello").textContent = currentUserName.split(" ").slice(-2).join(" ");
    loadHocPhan_HS();
    prefillHocSinh(data);
  }
  document.dispatchEvent(new CustomEvent("examflow:workspace-opened", {
    detail: { uid: user.uid, role: currentRole, name: currentUserName }
  }));
}

onAuthStateChanged(auth, async user => {
  const sequence = ++authStateSequence;
  try {
    if (user) {
      currentUser = user;

      const cachedProfile = readCachedProfile(user.uid);
      let workspaceOpenedFromCache = false;

      if (cachedProfile) {
        openAuthenticatedWorkspace(user, cachedProfile);
        workspaceOpenedFromCache = true;
        setLoading("btn-login", false);
        setLoading("btn-register", false);
      }

      let data = cachedProfile || {};
      try {
        const snap = await withTimeout(getDoc(doc(db, "users", user.uid)), cachedProfile ? 8000 : 12000);
        if (sequence !== authStateSequence || auth.currentUser?.uid !== user.uid) return;
        if (snap.exists()) data = snap.data();
      } catch (e) {
        console.error("Không đọc được hồ sơ người dùng:", e);
        if (!cachedProfile) {
          toast("Đã đăng nhập nhưng chưa đọc được hồ sơ Firestore: " + errMsg(e.code, e.message), false);
        }
      }

      if (sequence !== authStateSequence || auth.currentUser?.uid !== user.uid) return;

      // Trường hợp tài khoản chưa có hồ sơ: giữ hành vi tương thích cũ.
      if (!data.role) data.role = "hocsinh";
      if (!data.hoTen) data.hoTen = user.displayName || user.email || "Người dùng";

      if (data.disabled === true) {
        try { localStorage.removeItem(PROFILE_CACHE_PREFIX + user.uid); } catch {}
        toast("Tài khoản đã bị quản trị viên tạm khóa.", false);
        await signOut(auth);
        return;
      }

      data.role = normalizeSystemRole(data.role);
      writeCachedProfile(user.uid, data);
      const freshRole = normalizeSystemRole(data.role);
      const cachedRoleChanged = workspaceOpenedFromCache && cachedProfile?.role !== freshRole;

      if (!workspaceOpenedFromCache || cachedRoleChanged) {
        if (cachedRoleChanged) openedWorkspaceUid = null;
        openAuthenticatedWorkspace(user, data);
      } else {
        applyAuthenticatedProfile(user, data);
        if (currentRole === "hocsinh") {
          $("stat-hello").textContent = currentUserName.split(" ").slice(-2).join(" ");
          prefillHocSinh(data);
        }
      }

      // Tin nhắn thời gian thực được khởi tạo khi trình duyệt rảnh để không
      // tranh băng thông/CPU với màn hình đầu tiên sau đăng nhập.
      if (currentRole !== "admin") scheduleSocialInitialization(data);
    } else {
      cancelScheduledSocialInitialization();
      openedWorkspaceUid = null;

      if (jitsiApi) {
        try { jitsiApi.dispose(); } catch {}
        jitsiApi = null;
      }

      if (meetingClockTimer) {
        clearInterval(meetingClockTimer);
        meetingClockTimer = null;
      }

      activeOnlineMeeting = null;
      allOnlineMeetings = [];
      visibleOnlineMeetings = [];
      stopSocialListeners();
      resetSocialState();

      currentUser = null;
      currentRole = null;
      currentUserName = null;
      teacherHocPhanList = [];
      studentHocPhanList = [];
      hide("sidebar");
      closeMobileSidebar();
      document.body.classList.remove("role-student", "role-teacher", "role-admin", "app-entering");
      setScreen("screen-auth");
    }
  } catch (e) {
    console.error("Auth state error:", e);
    toast("Không thể mở tài khoản: " + errMsg(e.code, e.message), false);
    await signOut(auth).catch(() => {});
  } finally {
    if (sequence === authStateSequence) {
      setLoading("btn-login", false);
      setLoading("btn-register", false);
    }
  }
});

function buildNav(role) {
  const nav = $("sidebar-nav");
  if (role === "admin") {
    nav.innerHTML = `
      <div class="nav-section">Quản trị hệ thống</div>
      <div class="nav-item active" data-page="page-admin" title="Quản trị hệ thống"><span class="nav-icon">▣</span><span class="nav-label">Quản trị hệ thống</span></div>
      <div class="nav-section">Tài khoản quản trị</div>
      <div class="nav-item" data-page="page-settings" title="Hồ sơ và cài đặt"><span class="nav-icon">⚙</span><span class="nav-label">Hồ sơ & Cài đặt</span></div>`;
  } else if (role === "giaovien") {
    nav.innerHTML = `
      <div class="nav-section">Trung tâm điều hành</div>
      <div class="nav-item active" data-page="page-dashboard" title="Tổng quan"><span class="nav-icon">◫</span><span class="nav-label">Tổng quan</span></div>
      <div class="nav-item" data-page="page-announcements" title="Bảng tin"><span class="nav-icon">◈</span><span class="nav-label">Bảng tin</span><span id="announcement-nav-badge" class="nav-notification-badge hidden">0</span></div>
      <div class="nav-item" data-page="page-planner" title="Lịch và công việc"><span class="nav-icon">▦</span><span class="nav-label">Lịch & Công việc</span></div>
      <div class="nav-section">Quản lý giảng dạy</div>
      <div class="nav-item" data-page="page-hoc-phan" title="Học phần"><span class="nav-icon">⌂</span><span class="nav-label">Học phần</span></div>
      <div class="nav-item" data-page="page-dang-de" title="Đăng đề thi"><span class="nav-icon">⇧</span><span class="nav-label">Đăng đề thi</span></div>
      <div class="nav-item" data-page="page-ds-de" title="Danh sách đề"><span class="nav-icon">▤</span><span class="nav-label">Danh sách đề</span></div>
      <div class="nav-item" data-page="page-bai-nop" title="Bài nộp"><span class="nav-icon">↓</span><span class="nav-label">Bài nộp</span></div>
      <div class="nav-section">Kiểm tra & tương tác</div>
      <div class="nav-item" data-page="page-trac-nghiem-gv" title="Trắc nghiệm"><span class="nav-icon">◆</span><span class="nav-label">Trắc nghiệm</span></div>
      <div class="nav-item" data-page="page-lop-truc-tuyen" title="Lớp học trực tuyến"><span class="nav-icon">◎</span><span class="nav-label">Lớp học trực tuyến</span></div>
      <div class="nav-section">Cộng đồng & tài khoản</div>
      <div class="nav-item" data-page="page-ban-be" title="Tin nhắn và nhóm lớp"><span class="nav-icon">✦</span><span class="nav-label">Tin nhắn & Nhóm lớp</span><span id="social-nav-badge" class="nav-notification-badge hidden">0</span></div>
      <div class="nav-item" data-page="page-settings" title="Hồ sơ và cài đặt"><span class="nav-icon">⚙</span><span class="nav-label">Hồ sơ & Cài đặt</span></div>`;
  } else {
    nav.innerHTML = `
      <div class="nav-section">Không gian cá nhân</div>
      <div class="nav-item active" data-page="page-dashboard" title="Tổng quan"><span class="nav-icon">◫</span><span class="nav-label">Tổng quan</span></div>
      <div class="nav-item" data-page="page-announcements" title="Bảng tin"><span class="nav-icon">◈</span><span class="nav-label">Bảng tin</span><span id="announcement-nav-badge" class="nav-notification-badge hidden">0</span></div>
      <div class="nav-item" data-page="page-planner" title="Lịch và công việc"><span class="nav-icon">▦</span><span class="nav-label">Lịch & Công việc</span></div>
      <div class="nav-section">Học tập</div>
      <div class="nav-item" data-page="page-ghi-danh" title="Ghi danh học phần"><span class="nav-icon">◇</span><span class="nav-label">Ghi danh học phần</span></div>
      <div class="nav-item" data-page="page-tai-de" title="Tải đề thi"><span class="nav-icon">⇩</span><span class="nav-label">Tải đề thi</span></div>
      <div class="nav-item" data-page="page-nop-bai" title="Nộp bài"><span class="nav-icon">↗</span><span class="nav-label">Nộp bài</span></div>
      <div class="nav-item" data-page="page-ket-qua" title="Điểm của tôi"><span class="nav-icon">◒</span><span class="nav-label">Điểm của tôi</span></div>
      <div class="nav-section">Kiểm tra & tương tác</div>
      <div class="nav-item" data-page="page-trac-nghiem-hs" title="Trắc nghiệm"><span class="nav-icon">◆</span><span class="nav-label">Trắc nghiệm</span></div>
      <div class="nav-item" data-page="page-lop-truc-tuyen" title="Lớp học trực tuyến"><span class="nav-icon">◎</span><span class="nav-label">Lớp học trực tuyến</span></div>
      <div class="nav-section">Cộng đồng & tài khoản</div>
      <div class="nav-item" data-page="page-ban-be" title="Tin nhắn và nhóm lớp"><span class="nav-icon">✦</span><span class="nav-label">Tin nhắn & Nhóm lớp</span><span id="social-nav-badge" class="nav-notification-badge hidden">0</span></div>
      <div class="nav-item" data-page="page-settings" title="Hồ sơ và cài đặt"><span class="nav-icon">⚙</span><span class="nav-label">Hồ sơ & Cài đặt</span></div>`;
  }
  nav.querySelectorAll(".nav-item").forEach(item => {
    item.onclick = async () => {
      const targetPage = item.dataset.page;

      if (jitsiApi && targetPage !== "page-phong-hop") {
        const confirmed = confirm(
          "Bạn đang ở trong lớp học trực tuyến. Rời phòng để chuyển trang?"
        );
        if (!confirmed) return;
        await closeLiveClass(false);
      }

      setPage(targetPage);

      if (targetPage === "page-hoc-phan")        loadHocPhan_GV();
      if (targetPage === "page-ds-de")           loadDeThi_GV();
      if (targetPage === "page-bai-nop")         loadBaiNop();
      if (targetPage === "page-ghi-danh")        loadHocPhan_HS();
      if (targetPage === "page-tai-de")          loadDeThi_HS();
      if (targetPage === "page-nop-bai")         loadSubmissionExams();
      if (targetPage === "page-ket-qua")         loadKetQua_HS();
      if (targetPage === "page-lop-truc-tuyen")  loadOnlineMeetings();
      if (targetPage === "page-trac-nghiem-gv")  loadTracNghiem_GV();
      if (targetPage === "page-trac-nghiem-hs")  loadTracNghiem_HS();
      if (targetPage === "page-ban-be")           loadSocialHub();
    };
  });
}

/* ── Học phần: Giáo viên ─────────────────────────────────── */

async function maHPExists(ma) {
  return Boolean(await findCourseByNameOrOldCode(ma));
}

$("btn-tao-hp").onclick = async () => {
  const ten = $("hp-ten").value.trim();
  const mk  = $("hp-matkhau").value.trim();
  if (!ten || !mk) { toast("Vui lòng điền đủ thông tin (*)", false); return; }
  setLoading("btn-tao-hp", true, "Đang tạo…");
  try {
    // Tên giáo viên nhập đồng thời chính là mã học phần.
    const ma = ten;
    const maHocPhanKey = normalizeCourseName(ten);

    if (await maHPExists(ma)) {
      toast("Tên học phần này đã được sử dụng. Vui lòng nhập một tên khác.", false);
      setLoading("btn-tao-hp", false);
      return;
    }

    const matKhauHash = await hashPw(mk);
    const courseData = {
      maHocPhan: ma,
      maHocPhanKey,
      tenHocPhan: ten,
      matKhauHash,
      giaoVienId: currentUser.uid,
      giaoVienTen: currentUserName,
      createdAt: serverTimestamp()
    };
    const courseRef = await addDoc(collection(db, "hoc_phan"), courseData);
    await ensureClassGroupForCourse(courseRef.id, courseData, [currentUser.uid]);
    $("hp-ten").value = "";
    $("hp-matkhau").value = "";
    toast(`Tạo học phần thành công! Mã học phần: ${ma}`);
    loadHocPhan_GV();
  } catch (e) { toast("Lỗi tạo học phần: " + e.message, false); }
  setLoading("btn-tao-hp", false);
};

async function loadEnrollmentCountsForCourses(courseIds) {
  const counts = new Map(courseIds.map(id => [id, 0]));
  const chunks = [];
  for (let index = 0; index < courseIds.length; index += 30) {
    chunks.push(courseIds.slice(index, index + 30));
  }

  const snapshots = await Promise.all(chunks.map(ids =>
    getDocs(query(collection(db, "ghi_danh"), where("hocPhanId", "in", ids)))
  ));

  snapshots.forEach(snapshot => {
    snapshot.docs.forEach(item => {
      const courseId = item.data().hocPhanId;
      counts.set(courseId, (counts.get(courseId) || 0) + 1);
    });
  });
  return counts;
}

async function loadHocPhan_GV() {
  const tb = $("tb-hp");
  const loadingForUid = currentUser?.uid;
  tb.innerHTML = `<tr class="empty-row"><td colspan="4">Đang tải học phần…</td></tr>`;
  try {
    const snap = await getDocs(query(collection(db, "hoc_phan"), where("giaoVienId", "==", loadingForUid)));
    if (currentUser?.uid !== loadingForUid) return;

    teacherHocPhanList = newestFirst(snap.docs.map(d => ({ id: d.id, ...d.data() })));

    if (!teacherHocPhanList.length) {
      tb.innerHTML = `<tr class="empty-row"><td colspan="4">Bạn chưa tạo học phần nào.</td></tr>`;
      populateHocPhanSelects_GV();
      return;
    }

    // Hiển thị danh sách ngay sau một truy vấn đầu tiên. Số học sinh được tải
    // ở nền bằng truy vấn theo nhóm thay vì một truy vấn riêng cho mỗi học phần.
    tb.innerHTML = teacherHocPhanList.map(hp => {
      const encodedMa = encodeURIComponent(hp.maHocPhan || hp.tenHocPhan || "");
      return `<tr>
        <td>
          <span class="code-badge">
            ${courseLabel(hp)}
            <span class="copy-icon" title="Sao chép tên/mã học phần"
                  onclick="window._copyMaHP(decodeURIComponent('${encodedMa}'))">📋</span>
          </span>
        </td>
        <td data-hp-student-count="${hp.id}"><span class="inline-loading-dot">…</span></td>
        <td>${fmtDate(hp.createdAt)}</td>
        <td>
          <button class="btn-sm" onclick="window._openClassChat('${hp.id}')">💬 Nhóm lớp</button>
          <button class="btn-sm danger" onclick="window._xoaHP('${hp.id}')">Xóa</button>
        </td>
      </tr>`;
    }).join("");
    populateHocPhanSelects_GV();
    updatePremiumPageMetrics("page-hoc-phan");

    const courseIds = teacherHocPhanList.map(hp => hp.id);
    loadEnrollmentCountsForCourses(courseIds).then(counts => {
      if (currentUser?.uid !== loadingForUid) return;
      counts.forEach((count, courseId) => {
        const cell = tb.querySelector(`[data-hp-student-count="${CSS.escape(courseId)}"]`);
        if (cell) cell.textContent = String(count);
      });
    }).catch(error => {
      console.warn("Không tải được số học sinh:", error);
      tb.querySelectorAll("[data-hp-student-count]").forEach(cell => { cell.textContent = "—"; });
    });
  } catch (e) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="4">Không tải được học phần.</td></tr>`;
    toast("Lỗi tải học phần: " + e.message, false);
  }
}

window._xoaHP = async (id) => {
  if (!confirm("Xóa học phần này? Toàn bộ đề thi, bài nộp và ghi danh liên quan cũng sẽ bị xóa.")) return;
  try {
    const [deSnap, bnSnap, gdSnap] = await Promise.all([
      getDocs(query(collection(db, "de_thi"), where("hocPhanId", "==", id))),
      getDocs(query(collection(db, "bai_nop"), where("hocPhanId", "==", id))),
      getDocs(query(collection(db, "ghi_danh"), where("hocPhanId", "==", id))),
    ]);
    const classMessageSnap = await getDocs(collection(db, "nhom_chat_lop", id, "tin_nhan")).catch(() => null);
    await Promise.all([
      ...deSnap.docs.map(d => Promise.all([deleteDoc(d.ref), deleteObject(ref(storage, d.data().storagePath)).catch(() => {})])),
      ...bnSnap.docs.map(d => Promise.all([deleteDoc(d.ref), deleteObject(ref(storage, d.data().storagePath)).catch(() => {})])),
      ...gdSnap.docs.map(d => deleteDoc(d.ref)),
      ...(classMessageSnap?.docs || []).map(d => deleteDoc(d.ref).catch(() => {})),
    ]);
    await deleteDoc(doc(db, "nhom_chat_lop", id)).catch(() => {});
    await deleteDoc(doc(db, "hoc_phan", id));
    toast("Đã xóa học phần.");
    loadHocPhan_GV();
  } catch (e) { toast("Lỗi xóa học phần: " + e.message, false); }
};

function populateHocPhanSelects_GV() {
  const opts = teacherHocPhanList.map(hp => `<option value="${hp.id}">${courseLabel(hp)}</option>`).join("");
  const empty = `<option value="">— Bạn chưa có học phần nào —</option>`;

  $("dangde-hocphan").innerHTML = teacherHocPhanList.length ? opts : empty;

  $("dsde-hocphan-filter").innerHTML = `<option value="">Tất cả học phần</option>` + opts;
  $("bn-hocphan-filter").innerHTML   = `<option value="">Tất cả học phần</option>` + opts;

  const meetingCourse = $("meeting-course");
  if (meetingCourse) {
    meetingCourse.innerHTML = teacherHocPhanList.length ? opts : empty;
  }

  const tnHocPhan = $("tn-hocphan");
  if (tnHocPhan) {
    tnHocPhan.innerHTML = teacherHocPhanList.length ? opts : empty;
    $("tn-hp-hint")?.classList.toggle("hidden", teacherHocPhanList.length > 0);
  }
  const tnFilter = $("tn-hocphan-filter");
  if (tnFilter) {
    tnFilter.innerHTML = `<option value="">Tất cả học phần</option>` + opts;
  }
}

$("dsde-hocphan-filter").onchange = loadDeThi_GV;
$("bn-hocphan-filter").onchange   = loadBaiNop;

/* ── Học phần: Học sinh ──────────────────────────────────── */

$("btn-ghi-danh").onclick = async () => {
  const ma = $("gd-mahp").value.trim();
  const mk = $("gd-matkhau").value;
  if (!ma || !mk) { toast("Vui lòng nhập mã học phần và mật khẩu.", false); return; }
  setLoading("btn-ghi-danh", true, "Đang ghi danh…");
  try {
    const hpDoc = await findCourseByNameOrOldCode(ma);
    if (!hpDoc) {
      toast("Không tìm thấy học phần với tên/mã này.", false);
      setLoading("btn-ghi-danh", false);
      return;
    }
    const hp = hpDoc.data();

    const mkHash = await hashPw(mk);
    if (mkHash !== hp.matKhauHash) { toast("Sai mật khẩu ghi danh.", false); setLoading("btn-ghi-danh", false); return; }

    const existSnap = await getDocs(query(collection(db, "ghi_danh"), where("hocPhanId", "==", hpDoc.id), where("uid", "==", currentUser.uid)));
    if (!existSnap.empty) { toast("Bạn đã ghi danh học phần này rồi.", false); setLoading("btn-ghi-danh", false); return; }

    const enrollmentId = classEnrollmentId(hpDoc.id, currentUser.uid);
    await setDoc(doc(db, "ghi_danh", enrollmentId), {
      hocPhanId: hpDoc.id, maHocPhan: hp.maHocPhan, tenHocPhan: hp.tenHocPhan,
      uid: currentUser.uid, hoTen: currentUserName, createdAt: serverTimestamp()
    });
    await ensureClassGroupForCourse(hpDoc.id, hp, [currentUser.uid]);
    $("gd-mahp").value = ""; $("gd-matkhau").value = "";
    toast(`Ghi danh thành công! Nhóm chat lớp "${hp.tenHocPhan}" đã được thêm tự động. ✓`);
    loadHocPhan_HS();
  } catch (e) { toast("Lỗi ghi danh: " + e.message, false); }
  setLoading("btn-ghi-danh", false);
};

async function loadHocPhan_HS() {
  const tb = $("tb-hp-hs");
  tb.innerHTML = `<tr class="empty-row"><td colspan="4">Đang tải…</td></tr>`;
  try {
    const snap = await getDocs(query(collection(db, "ghi_danh"), where("uid", "==", currentUser.uid)));
    studentHocPhanList = newestFirst(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    $("stat-so-hp").textContent = studentHocPhanList.length;
    renderStudentCourses(studentHocPhanList);
    populateHocPhanSelects_HS();
  } catch (e) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="3">Không tải được danh sách học phần.</td></tr>`;
    toast("Lỗi tải học phần: " + e.message, false);
  }
}

function renderStudentCourses(list, searchQ = "") {
  const tb = $("tb-hp-hs");
  if (!list.length) {
    if (searchQ) {
      tb.innerHTML = "";
      show("hp-hs-noresult");
    } else {
      hide("hp-hs-noresult");
      tb.innerHTML = `<tr class="empty-row"><td colspan="3">Bạn chưa ghi danh học phần nào.</td></tr>`;
    }
    return;
  }
  hide("hp-hs-noresult");
  tb.innerHTML = list.map(gd => `
    <tr>
      <td><span class="code-badge">${courseLabel(gd)}</span></td>
      <td>${fmtDate(gd.createdAt)}</td>
      <td>
        <button class="btn-sm" onclick="window._openCourseExams('${gd.hocPhanId}')">📄 Xem đề</button>
        <button class="btn-sm" onclick="window._openClassChat('${gd.hocPhanId}')">💬 Nhóm lớp</button>
        <button class="btn-sm danger" onclick="window._huyGD('${gd.id}', '${gd.hocPhanId}')">Hủy</button>
      </td>
    </tr>`).join("");
}

$("search-hp-hs").oninput = e => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q
    ? studentHocPhanList.filter(gd =>
        (gd.tenHocPhan || "").toLowerCase().includes(q) ||
        (gd.maHocPhan || "").toLowerCase().includes(q))
    : studentHocPhanList;
  renderStudentCourses(filtered, q);
};

window._openCourseExams = hocPhanId => {
  setPage("page-tai-de");
  $("taide-hocphan").value = hocPhanId;
  loadDeThi_HS();
};

window._huyGD = async (id, hocPhanId) => {
  if (!confirm("Hủy ghi danh học phần này? Bạn cũng sẽ rời nhóm chat lớp.")) return;
  try {
    // Gỡ thành viên khỏi nhóm trước khi xóa ghi danh để Firestore Rules còn
    // xác minh được người dùng là thành viên hợp lệ của học phần.
    if (hocPhanId && currentUser) {
      await updateDoc(doc(db, "nhom_chat_lop", hocPhanId), {
        memberIds: arrayRemove(currentUser.uid),
        updatedAt: serverTimestamp()
      }).catch(error => console.warn("Không gỡ được khỏi nhóm lớp:", error));
    }
    await deleteDoc(doc(db, "ghi_danh", id));
    if (selectedClassGroup?.id === hocPhanId) closeClassGroupChat();
    toast("Đã hủy ghi danh và rời nhóm chat lớp.");
    loadHocPhan_HS();
  } catch (e) { toast("Lỗi: " + e.message, false); }
};

function populateHocPhanSelects_HS() {
  const empty = `<option value="">— Bạn chưa ghi danh học phần nào —</option>`;
  const opts = studentHocPhanList
    .map(gd => `<option value="${gd.hocPhanId}">${courseLabel(gd)}</option>`)
    .join("");

  $("taide-hocphan").innerHTML  = studentHocPhanList.length ? opts : empty;
  $("nopbai-hocphan").innerHTML = studentHocPhanList.length ? opts : empty;

  loadSubmissionExams();
}

$("taide-hocphan").onchange = loadDeThi_HS;
$("nopbai-hocphan").onchange = () => loadSubmissionExams();
$("nopbai-dethi").onchange = updateSubmissionDeadlineBanner;

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function setupDrop({
  key, dropId, inputId, labelId, previewId, nameId, metaId, removeId,
  defaultLabel, allowedExtensions = null, maxSizeMB = 25
}) {
  const zone = $(dropId);
  const input = $(inputId);
  const label = $(labelId);
  const preview = previewId ? $(previewId) : null;
  const fileName = nameId ? $(nameId) : null;
  const fileMeta = metaId ? $(metaId) : null;
  const removeButton = removeId ? $(removeId) : null;
  const maxSize = maxSizeMB * 1024 * 1024;

  // Không để sai một ID làm dừng toàn bộ renderer.js.
  if (!zone || !input || !label) {
    console.error("Thiếu thành phần kéo thả file:", {
      dropId, inputId, labelId, previewId, nameId, metaId, removeId
    });
    return () => {};
  }

  const reset = () => {
    selectedFiles[key] = null;
    input.value = "";
    label.textContent = defaultLabel;
    zone.classList.remove("has-file", "dragover", "file-error");
    preview?.classList.add("hidden");
    if (fileName) fileName.textContent = "";
    if (fileMeta) fileMeta.textContent = "";
  };

  const choose = file => {
    if (!file) return;

    const extension = "." + (file.name.split(".").pop() || "").toLowerCase();

    if (allowedExtensions && !allowedExtensions.includes(extension)) {
      reset();
      zone.classList.add("file-error");
      toast("Định dạng file chưa được hỗ trợ.", false);
      return;
    }

    if (file.size > maxSize) {
      reset();
      zone.classList.add("file-error");
      toast(`File vượt quá dung lượng tối đa ${maxSizeMB} MB.`, false);
      return;
    }

    selectedFiles[key] = file;
    label.textContent = "Đã chọn file thành công";
    zone.classList.remove("file-error", "dragover");
    zone.classList.add("has-file");

    if (fileName) fileName.textContent = file.name;
    if (fileMeta) fileMeta.textContent = formatFileSize(file.size);
    preview?.classList.remove("hidden");
  };

  zone.onclick = event => {
    if (event.target !== input && event.target !== removeButton) input.click();
  };

  zone.onkeydown = event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  };

  input.onchange = () => choose(input.files?.[0]);

  zone.ondragenter = event => {
    event.preventDefault();
    zone.classList.add("dragover");
  };

  zone.ondragover = event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    zone.classList.add("dragover");
  };

  zone.ondragleave = event => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove("dragover");
  };

  zone.ondrop = event => {
    event.preventDefault();
    zone.classList.remove("dragover");
    choose(event.dataTransfer.files?.[0]);
  };

  if (removeButton) {
    removeButton.onclick = event => {
      event.stopPropagation();
      reset();
    };
  }

  return reset;
}

const resetDeFile = setupDrop({
  key: "de",
  dropId: "drop-de",
  inputId: "file-de",
  labelId: "drop-de-label",
  previewId: "file-de-info",
  nameId: "file-de-name",
  metaId: "file-de-size",
  removeId: "file-de-remove",
  defaultLabel: "Kéo file vào đây hoặc bấm để chọn",
  allowedExtensions: [".pdf", ".doc", ".docx", ".zip", ".rar", ".png", ".jpg", ".jpeg"],
  maxSizeMB: 25
});

const resetBaiFile = setupDrop({
  key: "bai",
  dropId: "drop-bai",
  inputId: "file-bai",
  labelId: "drop-bai-label",
  previewId: "file-bai-info",
  nameId: "file-bai-name",
  metaId: "file-bai-size",
  removeId: "file-bai-remove",
  defaultLabel: "Kéo file vào đây hoặc bấm để chọn",
  allowedExtensions: [".pdf", ".doc", ".docx", ".zip", ".rar", ".png", ".jpg", ".jpeg"],
  maxSizeMB: 25
});

function uploadWithProgress(storageRef, file, progId, pctId) {
  return new Promise((res, rej) => {
    const task = uploadBytesResumable(storageRef, file);
    show(progId + "-wrap");
    task.on("state_changed",
      snap => { const pct = Math.round(snap.bytesTransferred / snap.totalBytes * 100); $(progId).value = pct; $(pctId).textContent = pct + "%"; },
      rej,
      async () => { hide(progId + "-wrap"); res(await getDownloadURL(task.snapshot.ref)); }
    );
  });
}

const uploadExamButton = $("btn-upload-de");

if (uploadExamButton) {
  uploadExamButton.onclick = async () => {
    const file = selectedFiles.de || $("file-de")?.files?.[0];
    const moTa = $("mota-de")?.value.trim() || "";
    const hocPhanId = $("dangde-hocphan")?.value || "";
    const deadlineText = $("deadline-de")?.value || "";
    const deadlineDate = deadlineText ? new Date(deadlineText) : null;

    if (!currentUser) {
      toast("Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.", false);
      return;
    }

    if (!hocPhanId) {
      toast("Vui lòng tạo hoặc chọn học phần trước khi đăng đề.", false);
      return;
    }

    if (!moTa) {
      toast("Vui lòng nhập tên hoặc mô tả đề thi.", false);
      return;
    }

    if (!deadlineDate || Number.isNaN(deadlineDate.getTime())) {
      toast("Vui lòng chọn hạn nộp bài.", false);
      return;
    }

    if (deadlineDate.getTime() <= Date.now()) {
      toast("Hạn nộp phải nằm sau thời điểm hiện tại.", false);
      return;
    }

    if (!file) {
      toast("Chưa chọn file đề thi.", false);
      return;
    }

    const hp = teacherHocPhanList.find(item => item.id === hocPhanId);
    if (!hp) {
      toast("Không tìm thấy thông tin học phần. Hãy tải lại danh sách học phần.", false);
      return;
    }

    setLoading("btn-upload-de", true, "Đang đăng đề…");

    try {
      const safeName = file.name.replace(/[\\/:*?"<>|]+/g, "_");
      const sRef = ref(
        storage,
        `de_thi/${currentUser.uid}/${hocPhanId}/${Date.now()}_${safeName}`
      );

      const url = await uploadWithProgress(
        sRef,
        file,
        "prog-de",
        "prog-de-pct"
      );

      try {
        await addDoc(collection(db, "de_thi"), {
          tenFile: file.name,
          moTa,
          url,
          storagePath: sRef.fullPath,
          fileSize: file.size,
          fileType: file.type || "",
          hocPhanId,
          maHocPhan: hp.maHocPhan || hp.tenHocPhan || "",
          tenHocPhan: hp.tenHocPhan || hp.maHocPhan || "",
          deadlineAt: Timestamp.fromDate(deadlineDate),
          deadlineUpdatedAt: serverTimestamp(),
          deadlineUpdatedBy: currentUser.uid,
          uploadedBy: currentUser.uid,
          createdAt: serverTimestamp()
        });
      } catch (firestoreError) {
        await deleteObject(sRef).catch(() => {});
        throw firestoreError;
      }

      if ($("mota-de")) $("mota-de").value = "";
      if ($("deadline-de")) $("deadline-de").value = "";
      resetDeFile();
      toast("Đăng đề thi thành công! ✓");
      await loadDeThi_GV();
    } catch (error) {
      console.error("Upload exam error:", error);
      const code = error?.code || "";

      if (code === "storage/unauthorized") {
        toast("Firebase Storage đang từ chối quyền tải file. Hãy kiểm tra Storage Rules.", false);
      } else if (code === "storage/canceled") {
        toast("Quá trình đăng đề đã bị hủy.", false);
      } else if (code === "storage/retry-limit-exceeded") {
        toast("Mạng không ổn định. Hãy thử đăng đề lại.", false);
      } else {
        toast("Lỗi đăng đề: " + (error?.message || code || "Không xác định"), false);
      }
    } finally {
      setLoading("btn-upload-de", false);
      $("prog-de-wrap")?.classList.add("hidden");
    }
  };
} else {
  console.error("Không tìm thấy nút btn-upload-de.");
}

async function loadDeThi_GV() {
  const tb = $("tb-de");
  const hocPhanId = $("dsde-hocphan-filter")?.value || "";

  if (!tb) return;
  tb.innerHTML = `<tr class="empty-row"><td colspan="7">Đang tải…</td></tr>`;

  try {
    const snap = await getDocs(collection(db, "de_thi"));
    let list = snap.docs.map(examDoc => ({
      id: examDoc.id,
      ...examDoc.data()
    }));

    list = hocPhanId
      ? list.filter(exam => exam.hocPhanId === hocPhanId)
      : list.filter(exam => exam.uploadedBy === currentUser.uid);

    allTeacherExams = newestFirst(
      list.filter(exam => exam.uploadedBy === currentUser.uid)
    );

    if (!list.length) {
      tb.innerHTML = `<tr class="empty-row"><td colspan="7">Chưa có đề thi nào.</td></tr>`;
      return;
    }

    tb.innerHTML = newestFirst(list).map(exam => {
      const status = getDeadlineStatus(exam.deadlineAt);
      const statusClass = !status.hasDeadline
        ? "neutral"
        : status.expired
          ? "late"
          : "ontime";

      return `<tr>
        <td><span class="code-badge">${escapeHtml(exam.maHocPhan || "—")}</span></td>
        <td><strong>${escapeHtml(examDisplayName(exam))}</strong><br><small>${escapeHtml(exam.tenFile || "")}</small></td>
        <td>${escapeHtml(exam.moTa || "—")}</td>
        <td>${fmtOptionalDate(exam.createdAt)}</td>
        <td>${fmtOptionalDate(exam.deadlineAt)}</td>
        <td><span class="deadline-badge ${statusClass}">${status.label}</span><small class="deadline-detail">${status.detail}</small></td>
        <td>
          <a class="btn-sm" href="${exam.url}" target="_blank" rel="noopener">Xem</a>
          <button class="btn-sm" onclick="window._openDeadlineModal('${exam.id}')">
            ${exam.deadlineAt ? "Gia hạn" : "Đặt hạn"}
          </button>
          <button class="btn-sm danger" onclick="window._xoaDe('${exam.id}','${encodeURIComponent(exam.storagePath || "")}')">Xóa</button>
        </td>
      </tr>`;
    }).join("");
  } catch (error) {
    console.error("Load teacher exams error:", error);
    tb.innerHTML = `<tr class="empty-row"><td colspan="7">Không tải được danh sách đề thi.</td></tr>`;
    toast("Lỗi tải đề: " + (error?.message || error?.code || "Không xác định"), false);
  }
}

$("btn-refresh-de").onclick = loadDeThi_GV;

window._openDeadlineModal = examId => {
  const exam = allTeacherExams.find(item => item.id === examId);

  if (!exam) {
    toast("Không tìm thấy đề thi cần gia hạn.", false);
    return;
  }

  selectedDeadlineExamId = examId;
  $("deadline-modal-exam").textContent = examDisplayName(exam);
  $("deadline-current-value").textContent = fmtOptionalDate(exam.deadlineAt);

  const currentDeadline = valueToDate(exam.deadlineAt);
  const suggested = currentDeadline && currentDeadline.getTime() > Date.now()
    ? new Date(currentDeadline.getTime() + 24 * 60 * 60 * 1000)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

  $("deadline-new-value").value = toDateTimeLocalValue(suggested);
  show("deadline-modal");
  $("deadline-new-value").focus();
};

function closeDeadlineModal() {
  selectedDeadlineExamId = null;
  hide("deadline-modal");
}

$("btn-close-deadline-modal").onclick = closeDeadlineModal;
$("btn-cancel-deadline").onclick = closeDeadlineModal;
$("deadline-modal").onclick = event => {
  if (event.target.id === "deadline-modal") closeDeadlineModal();
};

async function recalculateSubmissionsAfterExtension(exam, newDeadlineTimestamp) {
  const snapshot = await getDocs(query(
    collection(db, "bai_nop"),
    where("hocPhanId", "==", exam.hocPhanId)
  ));

  const related = snapshot.docs.filter(
    submissionDoc => submissionDoc.data().deThiId === exam.id
  );

  await Promise.all(related.map(async submissionDoc => {
    const submission = submissionDoc.data();
    const late = getSubmissionLateInfo(
      submission,
      { deadlineAt: newDeadlineTimestamp }
    );

    await updateDoc(submissionDoc.ref, {
      deadlineAtSnapshot: newDeadlineTimestamp,
      isLate: late.isLate,
      lateByMs: late.lateByMs,
      lateLabel: late.label
    });
  }));
}

$("btn-save-deadline").onclick = async () => {
  const exam = allTeacherExams.find(
    item => item.id === selectedDeadlineExamId
  );
  const newValue = $("deadline-new-value").value;
  const newDate = newValue ? new Date(newValue) : null;

  if (!exam) {
    toast("Không tìm thấy đề thi cần gia hạn.", false);
    return;
  }

  if (!newDate || Number.isNaN(newDate.getTime())) {
    toast("Vui lòng chọn thời hạn mới.", false);
    return;
  }

  const oldDeadline = valueToDate(exam.deadlineAt);

  if (oldDeadline && newDate.getTime() <= oldDeadline.getTime()) {
    toast("Thời hạn mới phải muộn hơn thời hạn hiện tại.", false);
    return;
  }

  if (!oldDeadline && newDate.getTime() <= Date.now()) {
    toast("Thời hạn mới phải nằm sau thời điểm hiện tại.", false);
    return;
  }

  setLoading("btn-save-deadline", true, "Đang gia hạn…");

  try {
    const newTimestamp = Timestamp.fromDate(newDate);

    await updateDoc(doc(db, "de_thi", exam.id), {
      deadlineAt: newTimestamp,
      deadlineUpdatedAt: serverTimestamp(),
      deadlineUpdatedBy: currentUser.uid
    });

    await recalculateSubmissionsAfterExtension(exam, newTimestamp);

    exam.deadlineAt = newTimestamp;
    closeDeadlineModal();
    toast("Đã gia hạn và tính lại trạng thái bài nộp. ✓");
    await loadDeThi_GV();
  } catch (error) {
    console.error("Extend deadline error:", error);

    if (error?.code === "permission-denied" ||
        error?.code === "firestore/permission-denied") {
      toast("Firestore chưa cho phép gia hạn hoặc cập nhật trạng thái bài nộp. Hãy Publish firestore.rules mới.", false);
    } else {
      toast("Không gia hạn được: " + (error?.message || error?.code || "Không xác định"), false);
    }
  } finally {
    setLoading("btn-save-deadline", false);
  }
};

window._xoaDe = async (id, encodedPath) => {
  if (!confirm("Xóa đề thi này?")) return;

  const path = decodeURIComponent(encodedPath || "");

  try {
    await deleteDoc(doc(db, "de_thi", id));
    if (path) await deleteObject(ref(storage, path)).catch(() => {});
    toast("Đã xóa đề thi.");
    await loadDeThi_GV();
  } catch (error) {
    toast("Lỗi xóa: " + (error?.message || error?.code || "Không xác định"), false);
  }
};

let allBaiNop = [];
let selectedSubmissionId = null;

async function loadBaiNop() {
  const tb = $("tb-bn");
  const selectedCourseId = $("bn-hocphan-filter")?.value || "";

  if (!tb) return;
  tb.innerHTML = `<tr class="empty-row"><td colspan="10">Đang tải…</td></tr>`;

  try {
    if (!teacherHocPhanList.length) {
      allBaiNop = [];
      teacherExamMap = new Map();
      renderBaiNop([]);
      return;
    }

    const allowedCourseIds = selectedCourseId
      ? teacherHocPhanList
          .filter(course => course.id === selectedCourseId)
          .map(course => course.id)
      : teacherHocPhanList.map(course => course.id);

    if (!allowedCourseIds.length) {
      allBaiNop = [];
      teacherExamMap = new Map();
      renderBaiNop([]);
      return;
    }

    const [submissionSnapshots, examSnapshots] = await Promise.all([
      Promise.all(
        allowedCourseIds.map(courseId =>
          getDocs(query(
            collection(db, "bai_nop"),
            where("hocPhanId", "==", courseId)
          ))
        )
      ),
      Promise.all(
        allowedCourseIds.map(courseId =>
          getDocs(query(
            collection(db, "de_thi"),
            where("hocPhanId", "==", courseId)
          ))
        )
      )
    ]);

    const unique = new Map();
    submissionSnapshots.forEach(snapshot => {
      snapshot.docs.forEach(submissionDoc => {
        unique.set(submissionDoc.id, {
          id: submissionDoc.id,
          ...submissionDoc.data()
        });
      });
    });

    teacherExamMap = new Map();
    examSnapshots.forEach(snapshot => {
      snapshot.docs.forEach(examDoc => {
        teacherExamMap.set(examDoc.id, {
          id: examDoc.id,
          ...examDoc.data()
        });
      });
    });

    allBaiNop = newestFirst([...unique.values()]);
    renderBaiNop(allBaiNop);
  } catch (error) {
    console.error("Load submissions error:", error);
    allBaiNop = [];
    tb.innerHTML = `<tr class="empty-row"><td colspan="10">Không tải được bài nộp.</td></tr>`;

    if (error?.code === "permission-denied" ||
        error?.code === "firestore/permission-denied") {
      toast("Firestore chưa cho phép giáo viên đọc bài nộp. Hãy cập nhật firestore.rules.", false);
    } else {
      toast("Lỗi tải bài nộp: " + (error?.message || error?.code || "Không xác định"), false);
    }
  }
}

$("btn-refresh-bn").onclick = loadBaiNop;

function renderBaiNop(list) {
  const tb = $("tb-bn");
  if (!tb) return;

  if (!list.length) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="10">Chưa có bài nộp nào.</td></tr>`;
    return;
  }

  tb.innerHTML = list.map(submission => {
    const exam = teacherExamMap.get(submission.deThiId);
    const late = getSubmissionLateInfo(submission, exam);
    const scoreClass = submission.diem === null ||
      submission.diem === undefined ||
      submission.diem === ""
        ? "pending"
        : "graded";

    return `
      <tr class="submission-row"
          title="Nhấn để xem và chấm bài"
          onclick="window._openSubmission('${submission.id}')">
        <td><span class="code-badge">${escapeHtml(submission.maHocPhan || submission.tenHocPhan || "—")}</span></td>
        <td>${escapeHtml(submission.tenDeThi || examDisplayName(exam) || "Bài nộp cũ")}</td>
        <td>${escapeHtml(submission.hoTen || "—")}</td>
        <td>${escapeHtml(submission.maSo || "—")}</td>
        <td>${escapeHtml(submission.lop || "—")}</td>
        <td>
          <button class="file-link-button"
                  onclick="event.stopPropagation(); window._openSubmission('${submission.id}')">
            📄 ${escapeHtml(submission.tenFile || "Bài làm")}
          </button>
        </td>
        <td>${fmtOptionalDate(submission.submittedAtClient || submission.createdAt)}</td>
        <td><span class="late-badge ${late.isLate ? "late" : "ontime"}">${escapeHtml(late.label)}</span></td>
        <td><span class="score-badge ${scoreClass}">${formatScore(submission.diem)}</span></td>
        <td>
          <button class="btn-sm"
                  onclick="event.stopPropagation(); window._openSubmission('${submission.id}')">
            Xem / Chấm
          </button>
          <button class="btn-sm danger"
                  onclick="event.stopPropagation(); window._xoaBN('${submission.id}','${encodeURIComponent(submission.storagePath || "")}')">
            Xóa
          </button>
        </td>
      </tr>`;
  }).join("");
}

$("search-bainop").oninput = event => {
  const keyword = event.target.value.trim().toLowerCase();

  const filtered = keyword
    ? allBaiNop.filter(submission =>
        (submission.hoTen || "").toLowerCase().includes(keyword) ||
        (submission.lop || "").toLowerCase().includes(keyword) ||
        (submission.maSo || "").toLowerCase().includes(keyword) ||
        (submission.tenFile || "").toLowerCase().includes(keyword) ||
        (submission.tenDeThi || "").toLowerCase().includes(keyword) ||
        (submission.maHocPhan || "").toLowerCase().includes(keyword))
    : allBaiNop;

  renderBaiNop(filtered);
};

window._openSubmission = submissionId => {
  const submission = allBaiNop.find(item => item.id === submissionId);

  if (!submission) {
    toast("Không tìm thấy thông tin bài nộp.", false);
    return;
  }

  const exam = teacherExamMap.get(submission.deThiId);
  const late = getSubmissionLateInfo(submission, exam);

  selectedSubmissionId = submissionId;

  $("grade-student-name").textContent = submission.hoTen || "—";
  $("grade-student-code").textContent = submission.maSo || "—";
  $("grade-student-class").textContent = submission.lop || "—";
  $("grade-course-name").textContent =
    submission.tenHocPhan || submission.maHocPhan || "—";
  $("grade-exam-name").textContent =
    submission.tenDeThi || examDisplayName(exam) || "Bài nộp cũ";
  $("grade-deadline").textContent = fmtOptionalDate(
    exam?.deadlineAt || submission.deadlineAtSnapshot
  );
  $("grade-late-status").textContent = late.label;
  $("grade-late-status").className =
    "late-badge " + (late.isLate ? "late" : "ontime");
  $("grade-file-name").textContent = submission.tenFile || "Bài làm";
  $("grade-submitted-at").textContent = fmtOptionalDate(
    submission.submittedAtClient || submission.createdAt
  );

  const downloadLink = $("grade-download-link");
  downloadLink.href = submission.url || "#";
  downloadLink.classList.toggle("disabled", !submission.url);
  downloadLink.setAttribute(
    "aria-disabled",
    submission.url ? "false" : "true"
  );

  $("grade-score").value =
    submission.diem === null ||
    submission.diem === undefined
      ? ""
      : submission.diem;

  $("grade-comment").value = submission.nhanXet || "";

  show("submission-modal");
  $("grade-score").focus();
};

function closeSubmissionModal() {
  selectedSubmissionId = null;
  hide("submission-modal");
}

$("btn-close-submission-modal").onclick = closeSubmissionModal;
$("btn-cancel-grade").onclick = closeSubmissionModal;

$("submission-modal").onclick = event => {
  if (event.target.id === "submission-modal") closeSubmissionModal();
};

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (!$("submission-modal").classList.contains("hidden")) {
      closeSubmissionModal();
    }
    if (!$("deadline-modal").classList.contains("hidden")) {
      closeDeadlineModal();
    }
  }
});

$("grade-download-link").onclick = event => {
  if (event.currentTarget.classList.contains("disabled")) {
    event.preventDefault();
    toast("Bài nộp chưa có đường dẫn tải file.", false);
  }
};

$("btn-save-grade").onclick = async () => {
  if (!selectedSubmissionId) {
    toast("Chưa chọn bài nộp cần chấm.", false);
    return;
  }

  const scoreText = $("grade-score").value.trim();
  const comment = $("grade-comment").value.trim();

  if (scoreText === "") {
    toast("Vui lòng nhập điểm.", false);
    return;
  }

  const score = Number(scoreText);

  if (!Number.isFinite(score) || score < 0 || score > 10) {
    toast("Điểm phải nằm trong khoảng từ 0 đến 10.", false);
    return;
  }

  const submission = allBaiNop.find(item => item.id === selectedSubmissionId);

  if (!submission) {
    toast("Không tìm thấy bài nộp cần chấm.", false);
    return;
  }

  const ownsCourse = teacherHocPhanList.some(
    course => course.id === submission.hocPhanId
  );

  if (!ownsCourse) {
    toast("Bạn không có quyền chấm bài thuộc học phần này.", false);
    return;
  }

  setLoading("btn-save-grade", true, "Đang lưu điểm…");

  try {
    await updateDoc(doc(db, "bai_nop", selectedSubmissionId), {
      diem: score,
      nhanXet: comment,
      gradedAt: serverTimestamp(),
      gradedBy: currentUser.uid,
      gradedByName: currentUserName
    });

    Object.assign(submission, {
      diem: score,
      nhanXet: comment,
      gradedBy: currentUser.uid,
      gradedByName: currentUserName
    });

    renderBaiNop(allBaiNop);
    closeSubmissionModal();
    toast("Đã lưu điểm cho học sinh. ✓");
  } catch (error) {
    console.error("Save grade error:", error);

    if (error?.code === "permission-denied" ||
        error?.code === "firestore/permission-denied") {
      toast("Firestore chưa cho phép giáo viên chấm điểm. Hãy Publish firestore.rules mới.", false);
    } else {
      toast("Không lưu được điểm: " + (error?.message || error?.code || "Không xác định"), false);
    }
  } finally {
    setLoading("btn-save-grade", false);
  }
};

window._xoaBN = async (id, encodedPath) => {
  if (!confirm("Xóa bài nộp này?")) return;

  const path = decodeURIComponent(encodedPath || "");

  try {
    await deleteDoc(doc(db, "bai_nop", id));

    if (path) {
      await deleteObject(ref(storage, path)).catch(() => {});
    }

    if (selectedSubmissionId === id) closeSubmissionModal();

    toast("Đã xóa bài nộp.");
    await loadBaiNop();
  } catch (error) {
    console.error("Delete submission error:", error);
    toast("Lỗi xóa: " + (error?.message || error?.code || "Không xác định"), false);
  }
};

function prefillHocSinh(data) {
  $("hs-hoten").value = data.hoTen || "";
  $("hs-maso").value  = data.maSo  || "";
}

function renderDeThi_HS(list) {
  const tb = $("tb-de-hs");

  if (!list.length) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="6">Không có đề thi phù hợp.</td></tr>`;
    return;
  }

  tb.innerHTML = list.map(exam => {
    const status = getDeadlineStatus(exam.deadlineAt);
    const statusClass = !status.hasDeadline
      ? "neutral"
      : status.expired
        ? "late"
        : "ontime";

    return `<tr>
      <td><strong>${escapeHtml(examDisplayName(exam))}</strong><br><small>${escapeHtml(exam.tenFile || "")}</small></td>
      <td>${escapeHtml(exam.moTa || "—")}</td>
      <td>${fmtOptionalDate(exam.deadlineAt)}</td>
      <td><span class="deadline-badge ${statusClass}">${status.label}</span><small class="deadline-detail">${status.detail}</small></td>
      <td><a class="btn-sm download-btn" href="${exam.url}" target="_blank" rel="noopener">⬇ Tải đề</a></td>
      <td><button class="btn-sm student" onclick="window._openExamSubmit('${exam.hocPhanId}','${exam.id}')">📤 Nộp bài</button></td>
    </tr>`;
  }).join("");
}

async function loadDeThi_HS() {
  const tb = $("tb-de-hs");
  const hocPhanId = $("taide-hocphan")?.value || "";

  if (!studentHocPhanList.length) {
    show("taide-hp-empty");
    allStudentExams = [];
    tb.innerHTML = "";
    return;
  }

  hide("taide-hp-empty");

  if (!hocPhanId) {
    allStudentExams = [];
    tb.innerHTML = `<tr class="empty-row"><td colspan="6">Hãy chọn một học phần để xem đề thi.</td></tr>`;
    return;
  }

  tb.innerHTML = `<tr class="empty-row"><td colspan="6">Đang tải…</td></tr>`;

  try {
    const snap = await getDocs(query(
      collection(db, "de_thi"),
      where("hocPhanId", "==", hocPhanId)
    ));

    allStudentExams = newestFirst(
      snap.docs.map(examDoc => ({
        id: examDoc.id,
        ...examDoc.data()
      }))
    );

    renderDeThi_HS(allStudentExams);
  } catch (error) {
    console.error("Load student exams error:", error);
    toast("Lỗi tải đề: " + (error?.message || error?.code || "Không xác định"), false);
  }
}

$("btn-refresh-hs-de").onclick = loadDeThi_HS;

async function loadSubmissionExams(preferredCourseId = "", preferredExamId = "") {
  const courseSelect = $("nopbai-hocphan");
  const examSelect = $("nopbai-dethi");

  if (!courseSelect || !examSelect) return;

  if (preferredCourseId) {
    courseSelect.value = preferredCourseId;
  }

  const courseId = courseSelect.value || "";

  if (!courseId) {
    submissionExamList = [];
    examSelect.innerHTML = `<option value="">— Chưa có học phần —</option>`;
    updateSubmissionDeadlineBanner();
    return;
  }

  examSelect.innerHTML = `<option value="">Đang tải đề thi…</option>`;

  try {
    const snapshot = await getDocs(query(
      collection(db, "de_thi"),
      where("hocPhanId", "==", courseId)
    ));

    submissionExamList = newestFirst(
      snapshot.docs.map(examDoc => ({
        id: examDoc.id,
        ...examDoc.data()
      }))
    );

    examSelect.innerHTML = submissionExamList.length
      ? submissionExamList
          .map(exam =>
            `<option value="${exam.id}">${escapeHtml(examDisplayName(exam))}</option>`
          )
          .join("")
      : `<option value="">— Học phần chưa có đề thi —</option>`;

    if (preferredExamId &&
        submissionExamList.some(exam => exam.id === preferredExamId)) {
      examSelect.value = preferredExamId;
    }

    updateSubmissionDeadlineBanner();
  } catch (error) {
    console.error("Load submission exams error:", error);
    submissionExamList = [];
    examSelect.innerHTML = `<option value="">— Không tải được đề thi —</option>`;
    updateSubmissionDeadlineBanner();
    toast("Không tải được đề để nộp bài.", false);
  }
}

function updateSubmissionDeadlineBanner() {
  const banner = $("nopbai-deadline-info");
  const examId = $("nopbai-dethi")?.value || "";
  const exam = submissionExamList.find(item => item.id === examId);

  if (!banner) return;

  if (!exam) {
    banner.className = "info-banner muted";
    banner.innerHTML = `<span class="info-banner-icon">ℹ️</span><span>Chọn đề thi để xem hạn nộp.</span>`;
    return;
  }

  const status = getDeadlineStatus(exam.deadlineAt);

  if (!status.hasDeadline) {
    banner.className = "info-banner muted";
    banner.innerHTML = `<span class="info-banner-icon">♾️</span><span>Đề thi này chưa giới hạn thời gian nộp.</span>`;
    return;
  }

  if (status.expired) {
    banner.className = "info-banner late-banner";
    banner.innerHTML = `<span class="info-banner-icon">⚠️</span><span>Hạn nộp: <strong>${fmtOptionalDate(exam.deadlineAt)}</strong>. ${status.detail}. Bạn vẫn có thể nộp, nhưng bài sẽ được đánh dấu nộp muộn.</span>`;
    return;
  }

  banner.className = "info-banner success-banner";
  banner.innerHTML = `<span class="info-banner-icon">⏳</span><span>Hạn nộp: <strong>${fmtOptionalDate(exam.deadlineAt)}</strong> — ${status.detail}.</span>`;
}

window._openExamSubmit = async (courseId, examId) => {
  setPage("page-nop-bai");
  await loadSubmissionExams(courseId, examId);
};

$("btn-nop-bai").onclick = async () => {
  const file = selectedFiles.bai || $("file-bai")?.files?.[0];
  const hoTen = $("hs-hoten")?.value.trim() || "";
  const maSo = $("hs-maso")?.value.trim() || "";
  const lop = $("hs-lop")?.value.trim() || "";
  const hocPhanId = $("nopbai-hocphan")?.value || "";
  const deThiId = $("nopbai-dethi")?.value || "";

  if (!hocPhanId) {
    toast("Vui lòng ghi danh học phần trước khi nộp bài.", false);
    return;
  }

  if (!deThiId) {
    toast("Vui lòng chọn đề thi cần nộp.", false);
    return;
  }

  if (!hoTen) {
    toast("Nhập họ và tên.", false);
    return;
  }

  if (!file) {
    toast("Chưa chọn file bài làm.", false);
    return;
  }

  const hp = studentHocPhanList.find(
    item => item.hocPhanId === hocPhanId
  );
  const exam = submissionExamList.find(
    item => item.id === deThiId
  );

  if (!hp || !exam) {
    toast("Không tìm thấy học phần hoặc đề thi đã chọn.", false);
    return;
  }

  const submittedAt = new Date();
  const deadline = valueToDate(exam.deadlineAt);
  const lateByMs = deadline
    ? Math.max(0, submittedAt.getTime() - deadline.getTime())
    : 0;
  const isLate = lateByMs > 0;
  const lateLabel = isLate
    ? `Nộp muộn ${formatDuration(lateByMs)}`
    : deadline
      ? "Đúng hạn"
      : "Không giới hạn";

  setLoading("btn-nop-bai", true, "Đang nộp…");

  try {
    const safeName = file.name.replace(/[\\/:*?"<>|]+/g, "_");
    const storageRef = ref(
      storage,
      `bai_nop/${hocPhanId}/${deThiId}/${currentUser.uid}/${Date.now()}_${safeName}`
    );

    const url = await uploadWithProgress(
      storageRef,
      file,
      "prog-bai",
      "prog-bai-pct"
    );

    try {
      await addDoc(collection(db, "bai_nop"), {
        hoTen,
        maSo,
        lop,
        tenFile: file.name,
        url,
        storagePath: storageRef.fullPath,
        fileSize: file.size,
        fileType: file.type || "",
        hocPhanId,
        maHocPhan: hp.maHocPhan || "",
        tenHocPhan: hp.tenHocPhan || "",
        deThiId,
        tenDeThi: examDisplayName(exam),
        deadlineAtSnapshot: exam.deadlineAt || null,
        submittedAtClient: Timestamp.fromDate(submittedAt),
        isLate,
        lateByMs,
        lateLabel,
        uid: currentUser.uid,
        email: currentUser.email,
        createdAt: serverTimestamp()
      });
    } catch (firestoreError) {
      await deleteObject(storageRef).catch(() => {});
      throw firestoreError;
    }

    resetBaiFile();
    toast(isLate
      ? `Nộp bài thành công — ${lateLabel}.`
      : "Nộp bài thành công! ✓"
    );
  } catch (error) {
    console.error("Submit assignment error:", error);

    if (error?.code === "storage/unauthorized") {
      toast("Firebase Storage chưa cho phép tải bài làm.", false);
    } else {
      toast("Lỗi nộp bài: " + (error?.message || error?.code || "Không xác định"), false);
    }
  } finally {
    setLoading("btn-nop-bai", false);
    $("prog-bai-wrap")?.classList.add("hidden");
  }
};

function studentScoreNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10, number)) : null;
}

function studentScoreClass(score) {
  if (score === null) return { label: "Chờ điểm", className: "pending" };
  if (score >= 9) return { label: "Xuất sắc", className: "excellent" };
  if (score >= 8) return { label: "Giỏi", className: "good" };
  if (score >= 6.5) return { label: "Khá", className: "fair" };
  if (score >= 5) return { label: "Đạt", className: "pass" };
  return { label: "Chưa đạt", className: "weak" };
}

function quizSubmissionStatus(reason) {
  return ({
    tu_nop: "Đã nộp",
    het_gio: "Tự nộp khi hết giờ",
    tu_dong_vi_pham: "Tự nộp do vi phạm"
  })[reason] || "Đã nộp";
}

function studentScoreDateMs(value) {
  return valueToDate(value)?.getTime() || 0;
}

function createAssignmentScoreRecord(submission, examMap) {
  const exam = examMap.get(submission.deThiId);
  const late = getSubmissionLateInfo(submission, exam);
  const score = studentScoreNumber(submission.diem);

  return {
    id: `assignment:${submission.id}`,
    sourceId: submission.id,
    source: "assignment",
    sourceLabel: "Tự luận",
    courseId: submission.hocPhanId || "",
    course: submission.maHocPhan || submission.tenHocPhan || "Chưa xác định",
    title: submission.tenDeThi || examDisplayName(exam) || "Bài nộp cũ",
    submittedAt: submission.submittedAtClient || submission.createdAt,
    deadlineAt: exam?.deadlineAt || submission.deadlineAtSnapshot,
    score,
    pendingReason: score === null ? "Giáo viên chưa chấm" : "",
    statusLabel: late.label,
    statusClass: late.isLate ? "late" : "ontime",
    isLate: late.isLate,
    comment: score === null
      ? "Giáo viên chưa chấm bài"
      : (submission.nhanXet || "Không có nhận xét"),
    url: submission.url || "",
    raw: submission
  };
}

function createQuizScoreRecord(result) {
  const hiddenScore = result.hienDiemNgay === false;
  const score = hiddenScore ? null : studentScoreNumber(result.diem);
  const correctText = result.tongSoCau
    ? `${result.soCauDung ?? 0}/${result.tongSoCau} câu đúng`
    : "Đã hoàn thành bài";
  const violationText = result.tongSoViPham
    ? ` · ${result.tongSoViPham} vi phạm`
    : "";

  return {
    id: `quiz:${result.id}`,
    sourceId: result.id,
    source: "quiz",
    sourceLabel: "Trắc nghiệm",
    courseId: result.hocPhanId || "",
    course: result.maHocPhan || result.tenHocPhan || "Chưa xác định",
    title: result.tieuDe || "Bài trắc nghiệm",
    submittedAt: result.nopAtClient || result.createdAt,
    deadlineAt: null,
    score,
    pendingReason: hiddenScore ? "Điểm đang chờ công bố" : "",
    statusLabel: quizSubmissionStatus(result.trangThaiNop),
    statusClass: result.trangThaiNop === "tu_dong_vi_pham" ? "late" : "ontime",
    isLate: false,
    comment: hiddenScore ? "Giáo viên chưa công bố điểm" : correctText + violationText,
    url: "",
    raw: result
  };
}

function setStudentScoreLoading() {
  const ids = ["score-average", "score-highest", "score-graded-count", "score-ontime-rate"];
  ids.forEach(id => { if ($(id)) $(id).textContent = "…"; });
  $("score-chart-empty")?.classList.add("hidden");
}

async function loadKetQua_HS() {
  const tb = $("tb-ket-qua");
  if (!tb || !currentUser) return;

  tb.innerHTML = `<tr class="empty-row"><td colspan="8">Đang tổng hợp điểm số…</td></tr>`;
  setStudentScoreLoading();
  setLoading("btn-refresh-ket-qua", true, "Đang tải…");

  const assignmentPromise = getDocs(query(
    collection(db, "bai_nop"),
    where("uid", "==", currentUser.uid)
  ));
  const quizPromise = getDocs(query(
    collection(db, "bai_lam_trac_nghiem"),
    where("uid", "==", currentUser.uid)
  ));

  try {
    const [assignmentResult, quizResult] = await Promise.allSettled([
      assignmentPromise,
      quizPromise
    ]);

    if (assignmentResult.status === "fulfilled") {
      allStudentResults = newestFirst(
        assignmentResult.value.docs.map(item => ({ id: item.id, ...item.data() }))
      );
    } else {
      console.error("Load assignment scores error:", assignmentResult.reason);
      allStudentResults = [];
    }

    const quizResults = quizResult.status === "fulfilled"
      ? newestFirst(quizResult.value.docs.map(item => ({ id: item.id, ...item.data() })))
      : [];
    if (quizResult.status === "rejected") {
      console.error("Load quiz scores error:", quizResult.reason);
    }

    const courseIds = [...new Set(
      allStudentResults.map(item => item.hocPhanId).filter(Boolean)
    )];
    const examSettled = await Promise.allSettled(
      courseIds.map(courseId => getDocs(query(
        collection(db, "de_thi"),
        where("hocPhanId", "==", courseId)
      )))
    );

    studentScoreExamMap = new Map();
    examSettled.forEach(result => {
      if (result.status !== "fulfilled") return;
      result.value.docs.forEach(examDoc => {
        studentScoreExamMap.set(examDoc.id, { id: examDoc.id, ...examDoc.data() });
      });
    });

    allStudentScoreRecords = [
      ...allStudentResults.map(item => createAssignmentScoreRecord(item, studentScoreExamMap)),
      ...quizResults.map(createQuizScoreRecord)
    ].sort((a, b) => studentScoreDateMs(b.submittedAt) - studentScoreDateMs(a.submittedAt));

    populateStudentScoreFilters(allStudentScoreRecords);
    applyStudentScoreFilters();

    if (assignmentResult.status === "rejected" && quizResult.status === "rejected") {
      throw assignmentResult.reason || quizResult.reason;
    }
    if (assignmentResult.status === "rejected" || quizResult.status === "rejected") {
      toast("Một phần dữ liệu điểm chưa tải được; các kết quả còn lại vẫn được hiển thị.", false);
    }
  } catch (error) {
    console.error("Load student results error:", error);
    allStudentScoreRecords = [];
    activeStudentScoreRecords = [];
    renderStudentScoreDashboard([]);
    tb.innerHTML = `<tr class="empty-row"><td colspan="8">Không tải được kết quả.</td></tr>`;
    toast("Lỗi tải kết quả: " + (error?.message || error?.code || "Không xác định"), false);
  } finally {
    setLoading("btn-refresh-ket-qua", false);
  }
}

function populateStudentScoreFilters(records) {
  const select = $("score-filter-course");
  if (!select) return;
  const current = select.value;
  const courses = [...new Map(records.map(item => [item.courseId || item.course, item.course])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "vi"));
  select.innerHTML = `<option value="">Tất cả học phần</option>` + courses.map(([id, name]) =>
    `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`
  ).join("");
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function filteredStudentScoreRecords() {
  const course = $("score-filter-course")?.value || "";
  const source = $("score-filter-source")?.value || "";
  const status = $("score-filter-status")?.value || "";
  const keyword = normalizeCourseName($("score-search")?.value || "");

  return allStudentScoreRecords.filter(item => {
    const courseKey = item.courseId || item.course;
    if (course && courseKey !== course) return false;
    if (source && item.source !== source) return false;
    if (status === "graded" && item.score === null) return false;
    if (status === "pending" && item.score !== null) return false;
    if (keyword) {
      const haystack = normalizeCourseName(`${item.course} ${item.title} ${item.sourceLabel} ${item.comment}`);
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

function applyStudentScoreFilters() {
  activeStudentScoreRecords = filteredStudentScoreRecords();
  renderStudentScoreDashboard(activeStudentScoreRecords);
}

function renderStudentScoreDashboard(records) {
  renderStudentScoreSummary(records);
  renderStudentScoreTable(records);
  renderStudentScoreChart(records);
  if ($("score-filter-count")) {
    $("score-filter-count").textContent = `${records.length} kết quả`;
  }
  updatePremiumPageMetrics("page-ket-qua");
}

function averageStudentScore(records) {
  const scores = records.map(item => item.score).filter(score => score !== null);
  if (!scores.length) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function renderStudentScoreSummary(records) {
  const graded = records.filter(item => item.score !== null);
  const scores = graded.map(item => item.score);
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
  const highestRecord = graded.reduce((best, item) => !best || item.score > best.score ? item : best, null);
  const assignments = records.filter(item => item.source === "assignment");
  const onTime = assignments.filter(item => !item.isLate).length;
  const onTimeRate = assignments.length ? Math.round(onTime / assignments.length * 100) : null;
  const pending = records.length - graded.length;
  const good = graded.filter(item => item.score >= 8).length;
  const passed = graded.filter(item => item.score >= 5).length;

  $("score-average").textContent = average === null ? "—" : average.toFixed(2);
  $("score-average-note").textContent = average === null
    ? "Chưa có bài được chấm"
    : `Tính trên ${graded.length} kết quả đã công bố`;
  $("score-highest").textContent = highestRecord ? highestRecord.score.toLocaleString("vi-VN") : "—";
  $("score-highest-note").textContent = highestRecord ? highestRecord.title : "Đang chờ dữ liệu";
  $("score-graded-count").textContent = `${graded.length}/${records.length}`;
  $("score-graded-note").textContent = `${pending} bài đang chờ chấm hoặc công bố`;
  $("score-ontime-rate").textContent = onTimeRate === null ? "—" : `${onTimeRate}%`;
  $("score-ontime-note").textContent = assignments.length
    ? `${onTime}/${assignments.length} bài tự luận đúng hạn`
    : "Chỉ tính bài tự luận";
  $("score-good-count").textContent = String(good);
  $("score-pass-count").textContent = String(passed);
  $("score-pending-count").textContent = String(pending);

  const ring = $("score-ring");
  ring?.style.setProperty("--score-progress", `${average === null ? 0 : Math.max(0, Math.min(100, average * 10))}%`);
  $("score-ring-value").textContent = average === null ? "—" : average.toFixed(1);

  let label = "Chưa có đánh giá";
  let note = "Khi có điểm, hệ thống sẽ tự động phân tích kết quả của bạn.";
  if (average !== null) {
    if (average >= 9) {
      label = "Phong độ xuất sắc";
      note = "Bạn đang duy trì mức điểm rất cao. Hãy tiếp tục giữ sự ổn định giữa các học phần.";
    } else if (average >= 8) {
      label = "Kết quả rất tốt";
      note = "Nền tảng kiến thức đang vững. Tập trung thêm vào các bài dưới 8 điểm để tăng trung bình.";
    } else if (average >= 6.5) {
      label = "Tiến độ khá ổn";
      note = "Bạn đang ở mức khá. Xem lại nhận xét của giáo viên để cải thiện những phần còn thiếu.";
    } else if (average >= 5) {
      label = "Đã đạt yêu cầu";
      note = "Kết quả đã đạt, nhưng vẫn còn dư địa cải thiện. Ưu tiên các học phần có điểm thấp nhất.";
    } else {
      label = "Cần củng cố kiến thức";
      note = "Hãy xem lại bài chưa đạt, ghi chú lỗi thường gặp và trao đổi thêm với giáo viên.";
    }
  }
  $("score-performance-label").textContent = label;
  $("score-performance-note").textContent = note;
}

function renderStudentScoreTable(records) {
  const tb = $("tb-ket-qua");
  if (!tb) return;
  if (!records.length) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="8">Không có kết quả phù hợp với bộ lọc.</td></tr>`;
    return;
  }

  tb.innerHTML = records.map(item => {
    const scoreMeta = studentScoreClass(item.score);
    const detail = item.url
      ? `<div class="score-detail-cell"><span>${escapeHtml(item.comment)}</span><a class="btn-sm" href="${item.url}" target="_blank" rel="noopener">Xem bài</a></div>`
      : `<div class="score-detail-cell"><span>${escapeHtml(item.comment)}</span></div>`;
    return `<tr class="score-result-row">
      <td><span class="code-badge">${escapeHtml(item.course)}</span></td>
      <td><div class="score-title-cell"><strong>${escapeHtml(item.title)}</strong>${item.deadlineAt ? `<small>Hạn: ${fmtOptionalDate(item.deadlineAt)}</small>` : ""}</div></td>
      <td><span class="score-source-badge ${item.source}">${escapeHtml(item.sourceLabel)}</span></td>
      <td>${fmtOptionalDate(item.submittedAt)}</td>
      <td><span class="score-value-badge ${scoreMeta.className}">${item.score === null ? "—" : item.score.toLocaleString("vi-VN")}</span></td>
      <td><span class="score-rank-badge ${scoreMeta.className}">${scoreMeta.label}</span></td>
      <td><span class="late-badge ${item.statusClass}">${escapeHtml(item.statusLabel)}</span></td>
      <td>${detail}</td>
    </tr>`;
  }).join("");
}

function scoreChartPalette() {
  const styles = getComputedStyle(document.documentElement);
  const bodyStyles = getComputedStyle(document.body);
  return {
    primary: bodyStyles.getPropertyValue("--primary").trim() || "#635bff",
    primary2: bodyStyles.getPropertyValue("--primary-3").trim() || "#8b5cf6",
    cyan: styles.getPropertyValue("--cyan").trim() || "#22d3ee",
    text: bodyStyles.getPropertyValue("--text").trim() || "#15192b",
    muted: bodyStyles.getPropertyValue("--muted").trim() || "#7b8196",
    border: bodyStyles.getPropertyValue("--border").trim() || "rgba(21,27,44,.1)",
    surface: bodyStyles.getPropertyValue("--surface-solid").trim() || "#fff",
    success: bodyStyles.getPropertyValue("--success").trim() || "#0ba77a",
    danger: bodyStyles.getPropertyValue("--danger").trim() || "#e5484d"
  };
}

function prepareScoreCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(320, rect.width || 680);
  const height = Math.max(250, rect.height || 300);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function roundedScoreRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawScoreGrid(ctx, left, top, width, height, palette) {
  ctx.save();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  for (let i = 0; i <= 5; i++) {
    const y = top + height - (height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDistributionScoreChart(ctx, width, height, records, palette) {
  const bins = [
    { label: "0–<5", min: 0, max: 5 },
    { label: "5–<6.5", min: 5, max: 6.5 },
    { label: "6.5–<8", min: 6.5, max: 8 },
    { label: "8–<9", min: 8, max: 9 },
    { label: "9–10", min: 9, max: 10.01 }
  ];
  const scores = records.map(item => item.score).filter(value => value !== null);
  bins.forEach(bin => { bin.value = scores.filter(score => score >= bin.min && score < bin.max).length; });
  const maxValue = Math.max(1, ...bins.map(item => item.value));
  const left = 42, right = 18, top = 18, bottom = 46;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  drawScoreGrid(ctx, left, top, chartWidth, chartHeight, palette);
  const slot = chartWidth / bins.length;
  const barWidth = Math.min(58, slot * .56);
  bins.forEach((item, index) => {
    const x = left + slot * index + (slot - barWidth) / 2;
    const barHeight = item.value ? Math.max(7, item.value / maxValue * (chartHeight - 18)) : 3;
    const y = top + chartHeight - barHeight;
    const gradient = ctx.createLinearGradient(0, y, 0, top + chartHeight);
    gradient.addColorStop(0, index >= 3 ? palette.success : palette.primary2);
    gradient.addColorStop(1, index >= 3 ? palette.cyan : palette.primary);
    roundedScoreRect(ctx, x, y, barWidth, barHeight, 9);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.fillStyle = palette.text;
    ctx.font = '700 12px "Be Vietnam Pro", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(String(item.value), x + barWidth / 2, Math.max(top + 12, y - 8));
    ctx.fillStyle = palette.muted;
    ctx.font = '600 10px "Be Vietnam Pro", sans-serif';
    ctx.fillText(item.label, x + barWidth / 2, top + chartHeight + 28);
  });
  return bins.map(item => ({ label: item.label, value: `${item.value} bài` }));
}

function drawCourseScoreChart(ctx, width, height, records, palette) {
  const groups = new Map();
  records.forEach(item => {
    if (item.score === null) return;
    const group = groups.get(item.course) || [];
    group.push(item.score);
    groups.set(item.course, group);
  });
  const rows = [...groups.entries()].map(([label, scores]) => ({
    label,
    value: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    count: scores.length
  })).sort((a, b) => b.value - a.value).slice(0, 8);
  const left = Math.min(150, Math.max(92, width * .23));
  const right = 36, top = 14, bottom = 18;
  const chartWidth = width - left - right;
  const rowHeight = (height - top - bottom) / Math.max(1, rows.length);
  rows.forEach((item, index) => {
    const y = top + index * rowHeight + rowHeight * .22;
    const h = Math.min(22, rowHeight * .56);
    ctx.fillStyle = palette.border;
    roundedScoreRect(ctx, left, y, chartWidth, h, 8);
    ctx.fill();
    const gradient = ctx.createLinearGradient(left, 0, left + chartWidth, 0);
    gradient.addColorStop(0, palette.primary);
    gradient.addColorStop(1, palette.cyan);
    ctx.fillStyle = gradient;
    roundedScoreRect(ctx, left, y, chartWidth * item.value / 10, h, 8);
    ctx.fill();
    ctx.fillStyle = palette.text;
    ctx.font = '650 10px "Be Vietnam Pro", sans-serif';
    ctx.textAlign = "right";
    const label = item.label.length > 18 ? item.label.slice(0, 17) + "…" : item.label;
    ctx.fillText(label, left - 10, y + h * .72);
    ctx.textAlign = "left";
    ctx.font = '750 11px "Be Vietnam Pro", sans-serif';
    ctx.fillText(item.value.toFixed(2), Math.min(width - 30, left + chartWidth * item.value / 10 + 8), y + h * .72);
  });
  return rows.map(item => ({ label: item.label, value: `${item.value.toFixed(2)} · ${item.count} bài` }));
}

function drawTrendScoreChart(ctx, width, height, records, palette) {
  const points = records.filter(item => item.score !== null)
    .sort((a, b) => studentScoreDateMs(a.submittedAt) - studentScoreDateMs(b.submittedAt))
    .slice(-14);
  const left = 42, right = 24, top = 20, bottom = 42;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  drawScoreGrid(ctx, left, top, chartWidth, chartHeight, palette);
  ctx.fillStyle = palette.muted;
  ctx.font = '600 9px "Be Vietnam Pro", sans-serif';
  ctx.textAlign = "right";
  [0, 2, 4, 6, 8, 10].forEach(value => {
    const y = top + chartHeight - value / 10 * chartHeight;
    ctx.fillText(String(value), left - 8, y + 3);
  });
  if (points.length === 1) {
    points.push({ ...points[0], id: `${points[0].id}:copy` });
  }
  const coords = points.map((item, index) => ({
    item,
    x: left + (points.length === 1 ? chartWidth / 2 : index / (points.length - 1) * chartWidth),
    y: top + chartHeight - item.score / 10 * chartHeight
  }));
  if (coords.length) {
    const area = ctx.createLinearGradient(0, top, 0, top + chartHeight);
    area.addColorStop(0, `${palette.primary}38`);
    area.addColorStop(1, `${palette.primary}00`);
    ctx.beginPath();
    ctx.moveTo(coords[0].x, top + chartHeight);
    coords.forEach(point => ctx.lineTo(point.x, point.y));
    ctx.lineTo(coords[coords.length - 1].x, top + chartHeight);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();
    ctx.beginPath();
    coords.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.strokeStyle = palette.primary;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    coords.forEach(point => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = palette.surface;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = palette.primary;
      ctx.stroke();
    });
    const labelIndexes = new Set([0, Math.floor((coords.length - 1) / 2), coords.length - 1]);
    ctx.fillStyle = palette.muted;
    ctx.font = '600 9px "Be Vietnam Pro", sans-serif';
    ctx.textAlign = "center";
    coords.forEach((point, index) => {
      if (!labelIndexes.has(index)) return;
      const date = valueToDate(point.item.submittedAt);
      const label = date ? date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "—";
      ctx.fillText(label, point.x, top + chartHeight + 25);
    });
  }
  const unique = points.filter((item, index) => index === 0 || item.id !== points[index - 1]?.id + ":copy");
  return unique.slice(-5).reverse().map(item => ({ label: item.title, value: item.score.toLocaleString("vi-VN") }));
}

function renderStudentScoreChart(records = activeStudentScoreRecords) {
  const canvas = $("score-chart");
  const empty = $("score-chart-empty");
  const legend = $("score-chart-legend");
  if (!canvas || !empty || !legend) return;
  const graded = records.filter(item => item.score !== null);
  const hasData = graded.length > 0;
  empty.classList.toggle("hidden", hasData);
  canvas.classList.toggle("hidden", !hasData);
  legend.classList.toggle("hidden", !hasData);
  if (!hasData) {
    legend.innerHTML = "";
    return;
  }

  const { ctx, width, height } = prepareScoreCanvas(canvas);
  const palette = scoreChartPalette();
  let items = [];
  if (activeScoreChartMode === "course") {
    $("score-chart-title").textContent = "Điểm trung bình theo học phần";
    $("score-chart-description").textContent = "So sánh mức điểm trung bình giữa các học phần đang hiển thị.";
    items = drawCourseScoreChart(ctx, width, height, records, palette);
  } else if (activeScoreChartMode === "trend") {
    $("score-chart-title").textContent = "Xu hướng điểm số";
    $("score-chart-description").textContent = "Diễn biến tối đa 14 kết quả gần nhất theo thời gian.";
    items = drawTrendScoreChart(ctx, width, height, records, palette);
  } else {
    $("score-chart-title").textContent = "Phân bố điểm";
    $("score-chart-description").textContent = "Số bài theo từng khoảng điểm trên thang 10.";
    items = drawDistributionScoreChart(ctx, width, height, records, palette);
  }
  legend.innerHTML = items.slice(0, 8).map(item =>
    `<span><i></i><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.value)}</small></span>`
  ).join("");
}

function exportStudentScoresCsv() {
  const records = activeStudentScoreRecords;
  if (!records.length) {
    toast("Không có dữ liệu điểm để xuất.", false);
    return;
  }
  const rows = [["Học phần", "Bài đánh giá", "Loại", "Ngày nộp", "Điểm", "Xếp loại", "Trạng thái", "Chi tiết"]];
  records.forEach(item => {
    rows.push([
      item.course,
      item.title,
      item.sourceLabel,
      fmtOptionalDate(item.submittedAt),
      item.score === null ? "Chờ điểm" : String(item.score),
      studentScoreClass(item.score).label,
      item.statusLabel,
      item.comment
    ]);
  });
  const csv = "\ufeff" + rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `examflow-diem-so-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Đã xuất bảng điểm CSV.");
}

$("btn-refresh-ket-qua").onclick = loadKetQua_HS;
$("btn-export-score")?.addEventListener("click", exportStudentScoresCsv);
["score-filter-course", "score-filter-source", "score-filter-status"].forEach(id =>
  $(id)?.addEventListener("change", applyStudentScoreFilters)
);
$("score-search")?.addEventListener("input", applyStudentScoreFilters);
document.querySelectorAll(".score-chart-tab").forEach(button => {
  button.addEventListener("click", () => {
    activeScoreChartMode = button.dataset.scoreChart || "distribution";
    document.querySelectorAll(".score-chart-tab").forEach(item => item.classList.toggle("active", item === button));
    renderStudentScoreChart(activeStudentScoreRecords);
  });
});
window.addEventListener("resize", () => {
  clearTimeout(scoreChartResizeTimer);
  scoreChartResizeTimer = setTimeout(() => {
    if ($("page-ket-qua")?.classList.contains("active")) renderStudentScoreChart(activeStudentScoreRecords);
  }, 140);
});
new MutationObserver(() => {
  if ($("page-ket-qua")?.classList.contains("active")) {
    requestAnimationFrame(() => renderStudentScoreChart(activeStudentScoreRecords));
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });


/* ── Lớp học trực tuyến ───────────────────────────────────── */

function meetingDate(value) {
  return valueToDate(value);
}

function createMeetingRoomName() {
  const userPart = (currentUser?.uid || "teacher")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 10);

  const randomPart = crypto
    .getRandomValues(new Uint32Array(2))
    .join("");

  return `ThuGuiBaiThi-${userPart}-${Date.now()}-${randomPart}`;
}

function roundMeetingDate(date, minutes = 5) {
  const value = new Date(date);
  value.setSeconds(0, 0);
  const rounded = Math.ceil(value.getMinutes() / minutes) * minutes;
  value.setMinutes(rounded);
  return value;
}

function setDefaultMeetingSchedule(force = false) {
  const startInput = $("meeting-start");
  const endInput = $("meeting-end");

  if (!startInput || !endInput) return;
  if (!force && startInput.value && endInput.value) return;

  const start = roundMeetingDate(
    new Date(Date.now() + 30 * 60 * 1000)
  );
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  startInput.value = toDateTimeLocalValue(start);
  endInput.value = toDateTimeLocalValue(end);
}

function getMeetingState(meeting, now = new Date()) {
  if (meeting?.trangThai === "cancelled") {
    return {
      key: "cancelled",
      label: "Đã hủy",
      detail: "Buổi học đã bị giáo viên hủy.",
      canStudentJoin: false,
      canTeacherJoin: false
    };
  }

  const start = meetingDate(meeting?.batDauAt);
  const end = meetingDate(meeting?.ketThucAt);

  if (!start || !end) {
    return {
      key: "invalid",
      label: "Thiếu thời gian",
      detail: "Lịch học chưa có thời gian hợp lệ.",
      canStudentJoin: false,
      canTeacherJoin: false
    };
  }

  const nowMs = now.getTime();
  const startMs = start.getTime();
  const endMs = end.getTime();
  const studentOpenMs = startMs - 15 * 60 * 1000;

  if (nowMs > endMs) {
    return {
      key: "ended",
      label: "Đã kết thúc",
      detail: `Kết thúc lúc ${start.toLocaleDateString("vi-VN")} ${end.toLocaleTimeString("vi-VN", {hour: "2-digit", minute: "2-digit"})}`,
      canStudentJoin: false,
      canTeacherJoin: false
    };
  }

  if (nowMs >= studentOpenMs) {
    return {
      key: "live",
      label: nowMs < startMs ? "Sắp mở" : "Đang diễn ra",
      detail: nowMs < startMs
        ? `Bắt đầu sau ${formatDuration(startMs - nowMs)}`
        : `Còn ${formatDuration(endMs - nowMs)}`,
      canStudentJoin: true,
      canTeacherJoin: true
    };
  }

  return {
    key: "upcoming",
    label: "Sắp diễn ra",
    detail: `Bắt đầu sau ${formatDuration(startMs - nowMs)}`,
    canStudentJoin: false,
    canTeacherJoin: true
  };
}

function meetingSortValue(meeting) {
  const state = getMeetingState(meeting);
  const start = meetingDate(meeting.batDauAt)?.getTime() || 0;

  const order = {
    live: 0,
    upcoming: 1,
    ended: 2,
    cancelled: 3,
    invalid: 4
  };

  return [order[state.key] ?? 5, state.key === "ended" ? -start : start];
}

function sortMeetings(list) {
  return [...list].sort((a, b) => {
    const [groupA, timeA] = meetingSortValue(a);
    const [groupB, timeB] = meetingSortValue(b);

    if (groupA !== groupB) return groupA - groupB;
    return timeA - timeB;
  });
}

function isStudentEnrolledInMeeting(meeting) {
  return studentHocPhanList.some(
    enrollment => enrollment.hocPhanId === meeting.hocPhanId
  );
}

function prepareMeetingPage() {
  const teacherPanel = $("meeting-teacher-panel");
  const studentBanner = $("meeting-student-banner");
  const subtitle = $("meeting-page-subtitle");
  const title = $("meeting-list-title");

  if (currentRole === "giaovien") {
    teacherPanel?.classList.remove("hidden");
    studentBanner?.classList.add("hidden");

    if (subtitle) {
      subtitle.textContent =
        "Lên lịch, mở phòng và quản lý các buổi học theo học phần.";
    }

    if (title) title.textContent = "Lịch lớp học đã tạo";

    if (!teacherHocPhanList.length) {
      loadHocPhan_GV();
    } else {
      populateHocPhanSelects_GV();
    }

    setDefaultMeetingSchedule();
  } else {
    teacherPanel?.classList.add("hidden");
    studentBanner?.classList.remove("hidden");

    if (subtitle) {
      subtitle.textContent =
        "Xem lịch và tham gia các lớp thuộc học phần đã ghi danh.";
    }

    if (title) title.textContent = "Lịch lớp học của tôi";
  }
}

function filterOnlineMeetings() {
  const searchValue = ($("search-meetings")?.value || "")
    .trim()
    .toLowerCase();
  const statusValue = $("meeting-status-filter")?.value || "all";

  let list = allOnlineMeetings;

  if (statusValue !== "all") {
    list = list.filter(
      meeting => getMeetingState(meeting).key === statusValue
    );
  }

  if (searchValue) {
    list = list.filter(meeting => {
      const haystack = [
        meeting.tieuDe,
        meeting.tenHocPhan,
        meeting.maHocPhan,
        meeting.giaoVienTen,
        meeting.ghiChu
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchValue);
    });
  }

  visibleOnlineMeetings = sortMeetings(list);
  renderOnlineMeetings(visibleOnlineMeetings);
}

function renderOnlineMeetings(list) {
  const container = $("meeting-list");
  const description = $("meeting-list-description");

  if (!container) return;

  if (description) {
    description.textContent = list.length
      ? `${list.length} lịch học đang hiển thị`
      : "Không có lịch học phù hợp.";
  }

  if (!list.length) {
    container.innerHTML = `
      <div class="meeting-empty">
        <span>🎥</span>
        <strong>Chưa có lịch lớp học</strong>
        <p>${
          currentRole === "giaovien"
            ? "Hãy tạo lịch học đầu tiên ở biểu mẫu phía trên."
            : "Giáo viên chưa lên lịch cho các học phần của bạn."
        }</p>
      </div>`;
    return;
  }

  container.innerHTML = list.map(meeting => {
    const state = getMeetingState(meeting);
    const start = meetingDate(meeting.batDauAt);
    const end = meetingDate(meeting.ketThucAt);

    const canJoin = currentRole === "giaovien"
      ? state.canTeacherJoin
      : state.canStudentJoin;

    const encodedId = encodeURIComponent(meeting.id);
    const actionLabel = currentRole === "giaovien"
      ? "🎥 Mở lớp"
      : "🎥 Tham gia lớp";

    let buttonHint = "";
    if (!canJoin && state.key === "upcoming" && currentRole !== "giaovien") {
      buttonHint = "Mở trước giờ học 15 phút";
    } else if (!canJoin && state.key === "ended") {
      buttonHint = "Buổi học đã kết thúc";
    } else if (!canJoin && state.key === "cancelled") {
      buttonHint = "Lịch học đã bị hủy";
    }

    const teacherActions = currentRole === "giaovien" &&
      state.key !== "cancelled" &&
      state.key !== "ended"
        ? `
          <button class="btn-outline danger-outline"
                  onclick="window._cancelOnlineMeeting('${encodedId}')">
            Hủy lịch
          </button>`
        : "";

    return `
      <article class="meeting-card ${state.key}">
        <div class="meeting-card-top">
          <span class="meeting-status ${state.key}">
            ${escapeHtml(state.label)}
          </span>
          <span class="meeting-course-badge">
            ${escapeHtml(meeting.maHocPhan || meeting.tenHocPhan || "Học phần")}
          </span>
        </div>

        <h3>${escapeHtml(meeting.tieuDe || "Lớp học trực tuyến")}</h3>

        <div class="meeting-time-box">
          <span class="meeting-date">
            ${start ? start.toLocaleDateString("vi-VN") : "—"}
          </span>
          <strong>
            ${start ? start.toLocaleTimeString("vi-VN", {hour: "2-digit", minute: "2-digit"}) : "—"}
            –
            ${end ? end.toLocaleTimeString("vi-VN", {hour: "2-digit", minute: "2-digit"}) : "—"}
          </strong>
        </div>

        <div class="meeting-card-meta">
          <span>👨‍🏫 ${escapeHtml(meeting.giaoVienTen || "Giáo viên")}</span>
          <span>⏱️ ${escapeHtml(state.detail)}</span>
        </div>

        ${
          meeting.ghiChu
            ? `<p class="meeting-note">${escapeHtml(meeting.ghiChu)}</p>`
            : `<p class="meeting-note muted">Không có ghi chú.</p>`
        }

        <div class="meeting-card-actions">
          <button class="btn-primary meeting-join-button"
                  ${canJoin ? "" : "disabled"}
                  onclick="window._joinOnlineMeeting('${encodedId}')">
            ${actionLabel}
          </button>
          ${teacherActions}
        </div>

        ${buttonHint ? `<small class="meeting-button-hint">${buttonHint}</small>` : ""}
      </article>`;
  }).join("");
}

async function loadOnlineMeetings() {
  prepareMeetingPage();

  const container = $("meeting-list");
  if (container) {
    container.innerHTML =
      `<div class="student-empty">Đang tải lịch học…</div>`;
  }

  try {
    if (currentRole === "giaovien" && !teacherHocPhanList.length) {
      await loadHocPhan_GV();
    }

    if (currentRole !== "giaovien" && !studentHocPhanList.length) {
      await loadHocPhan_HS();
    }

    const snapshot = await getDocs(collection(db, "phong_hop"));

    const meetings = snapshot.docs.map(meetingDoc => ({
      id: meetingDoc.id,
      ...meetingDoc.data()
    }));

    allOnlineMeetings = currentRole === "giaovien"
      ? meetings.filter(
          meeting => meeting.giaoVienId === currentUser.uid
        )
      : meetings.filter(
          meeting => isStudentEnrolledInMeeting(meeting)
        );

    filterOnlineMeetings();
    startMeetingClock();
  } catch (error) {
    console.error("Load meetings error:", error);

    if (container) {
      container.innerHTML = `
        <div class="meeting-empty error">
          <span>⚠️</span>
          <strong>Không tải được lịch học</strong>
          <p>${escapeHtml(error?.message || "Lỗi không xác định")}</p>
        </div>`;
    }

    if (
      error?.code === "permission-denied" ||
      error?.code === "firestore/permission-denied"
    ) {
      toast(
        "Firestore chưa cho phép đọc lịch lớp học. Hãy Publish firestore.rules mới.",
        false
      );
    } else {
      toast(
        "Lỗi tải lịch học: " +
          (error?.message || error?.code || "Không xác định"),
        false
      );
    }
  }
}

function startMeetingClock() {
  if (meetingClockTimer) clearInterval(meetingClockTimer);

  meetingClockTimer = setInterval(() => {
    const page = $("page-lop-truc-tuyen");

    if (page && !page.classList.contains("hidden")) {
      filterOnlineMeetings();
    }
  }, 30000);
}

$("search-meetings").oninput = filterOnlineMeetings;
$("meeting-status-filter").onchange = filterOnlineMeetings;
$("btn-refresh-meetings").onclick = loadOnlineMeetings;

$("meeting-start").onchange = () => {
  const start = new Date($("meeting-start").value);
  const end = new Date($("meeting-end").value);

  if (
    !Number.isNaN(start.getTime()) &&
    (Number.isNaN(end.getTime()) || end <= start)
  ) {
    $("meeting-end").value = toDateTimeLocalValue(
      new Date(start.getTime() + 60 * 60 * 1000)
    );
  }
};

$("btn-create-meeting").onclick = async () => {
  if (currentRole !== "giaovien") {
    toast("Chỉ giáo viên được lên lịch lớp học.", false);
    return;
  }

  const hocPhanId = $("meeting-course").value;
  const tieuDe = $("meeting-title").value.trim();
  const ghiChu = $("meeting-note").value.trim();
  const batDau = new Date($("meeting-start").value);
  const ketThuc = new Date($("meeting-end").value);

  if (!hocPhanId || !tieuDe) {
    toast("Vui lòng chọn học phần và nhập tên buổi học.", false);
    return;
  }

  if (
    Number.isNaN(batDau.getTime()) ||
    Number.isNaN(ketThuc.getTime())
  ) {
    toast("Vui lòng chọn đầy đủ thời gian bắt đầu và kết thúc.", false);
    return;
  }

  if (ketThuc <= batDau) {
    toast("Thời gian kết thúc phải sau thời gian bắt đầu.", false);
    return;
  }

  if (ketThuc.getTime() <= Date.now()) {
    toast("Thời gian kết thúc phải nằm trong tương lai.", false);
    return;
  }

  const course = teacherHocPhanList.find(
    item => item.id === hocPhanId
  );

  if (!course) {
    toast("Không tìm thấy học phần đã chọn.", false);
    return;
  }

  setLoading("btn-create-meeting", true, "Đang tạo lịch…");

  try {
    await addDoc(collection(db, "phong_hop"), {
      tieuDe,
      ghiChu,
      hocPhanId,
      maHocPhan: course.maHocPhan || course.tenHocPhan || "",
      tenHocPhan: course.tenHocPhan || course.maHocPhan || "",
      giaoVienId: currentUser.uid,
      giaoVienTen: currentUserName,
      roomName: createMeetingRoomName(),
      batDauAt: Timestamp.fromDate(batDau),
      ketThucAt: Timestamp.fromDate(ketThuc),
      trangThai: "scheduled",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    $("meeting-title").value = "";
    $("meeting-note").value = "";
    setDefaultMeetingSchedule(true);

    toast("Đã tạo lịch lớp học. ✓");
    await loadOnlineMeetings();
  } catch (error) {
    console.error("Create meeting error:", error);

    if (
      error?.code === "permission-denied" ||
      error?.code === "firestore/permission-denied"
    ) {
      toast(
        "Firestore chưa cho phép tạo lịch học. Hãy Publish firestore.rules mới.",
        false
      );
    } else {
      toast(
        "Không tạo được lịch học: " +
          (error?.message || error?.code || "Không xác định"),
        false
      );
    }
  } finally {
    setLoading("btn-create-meeting", false);
  }
};

window._cancelOnlineMeeting = async encodedMeetingId => {
  const meetingId = decodeURIComponent(encodedMeetingId);
  const meeting = allOnlineMeetings.find(item => item.id === meetingId);

  if (!meeting || meeting.giaoVienId !== currentUser.uid) {
    toast("Bạn không có quyền hủy lịch học này.", false);
    return;
  }

  if (!confirm(`Hủy lịch "${meeting.tieuDe}"?`)) return;

  try {
    await updateDoc(doc(db, "phong_hop", meetingId), {
      trangThai: "cancelled",
      cancelledAt: serverTimestamp(),
      cancelledBy: currentUser.uid,
      updatedAt: serverTimestamp()
    });

    toast("Đã hủy lịch lớp học.");
    await loadOnlineMeetings();
  } catch (error) {
    console.error("Cancel meeting error:", error);
    toast(
      "Không hủy được lịch: " +
        (error?.message || error?.code || "Không xác định"),
      false
    );
  }
};

async function saveMeetingAttendance(meeting, joined = true) {
  if (!currentUser || !meeting) return;

  const attendanceId = `${meeting.id}_${currentUser.uid}`;
  const attendanceRef = doc(
    db,
    "tham_gia_lop_hoc",
    attendanceId
  );

  const baseData = {
    meetingId: meeting.id,
    roomName: meeting.roomName,
    hocPhanId: meeting.hocPhanId,
    tenHocPhan: meeting.tenHocPhan || meeting.maHocPhan || "",
    tieuDe: meeting.tieuDe || "",
    uid: currentUser.uid,
    hoTen: currentUserName,
    email: currentUser.email || "",
    role: currentRole,
    updatedAt: serverTimestamp()
  };

  try {
    if (joined) {
      await setDoc(
        attendanceRef,
        {
          ...baseData,
          firstJoinedAt: serverTimestamp(),
          lastJoinedAt: serverTimestamp()
        },
        { merge: true }
      );
    } else {
      await setDoc(
        attendanceRef,
        {
          ...baseData,
          lastLeftAt: serverTimestamp()
        },
        { merge: true }
      );
    }
  } catch (error) {
    console.error("Attendance error:", error);
  }
}

function setLiveMeetingStatus(kind, message) {
  const status = $("live-meeting-status");
  if (!status) return;

  status.className = `info-banner meeting-live-status ${kind}`;
  status.innerHTML = `
    <span class="info-banner-icon">${
      kind === "success"
        ? "✅"
        : kind === "error"
          ? "⚠️"
          : "⏳"
    }</span>
    <span>${escapeHtml(message)}</span>`;
}

let jitsiExternalApiPromise = null;

function loadJitsiExternalApi() {
  if (window.JitsiMeetExternalAPI) return Promise.resolve(window.JitsiMeetExternalAPI);
  if (jitsiExternalApiPromise) return jitsiExternalApiPromise;

  jitsiExternalApiPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-examflow-jitsi="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.JitsiMeetExternalAPI), { once: true });
      existing.addEventListener("error", () => reject(new Error("Không tải được Jitsi Meet.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://meet.jit.si/external_api.js";
    script.async = true;
    script.dataset.examflowJitsi = "1";
    script.onload = () => {
      if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI);
      else reject(new Error("Jitsi đã tải nhưng API không khả dụng."));
    };
    script.onerror = () => reject(new Error("Không tải được Jitsi Meet. Kiểm tra Internet."));
    document.head.appendChild(script);
  }).catch(error => {
    jitsiExternalApiPromise = null;
    throw error;
  });

  return jitsiExternalApiPromise;
}

async function startJitsiClass(meeting) {
  const container = $("jitsi-container");

  if (!container) {
    toast("Không tìm thấy vùng hiển thị phòng học.", false);
    return;
  }

  if (!window.JitsiMeetExternalAPI) {
    setLiveMeetingStatus("loading", "Đang tải dịch vụ phòng học trực tuyến…");
    try {
      await withTimeout(loadJitsiExternalApi(), 15000);
    } catch (error) {
      setLiveMeetingStatus("error", "Không tải được dịch vụ phòng họp. Kiểm tra kết nối Internet.");
      toast(error?.message || "Không tải được Jitsi Meet.", false);
      return;
    }
  }

  if (jitsiApi) {
    try { jitsiApi.dispose(); } catch {}
    jitsiApi = null;
  }

  container.innerHTML = "";

  try {
    jitsiApi = new window.JitsiMeetExternalAPI(
      "meet.jit.si",
      {
        roomName: meeting.roomName,
        width: "100%",
        height: 700,
        parentNode: container,
        lang: "vi",
        userInfo: {
          displayName: currentUserName || "Người dùng",
          email: currentUser?.email || ""
        },
        configOverwrite: {
          startWithAudioMuted: true,
          startWithVideoMuted: true,
          prejoinConfig: {
            enabled: true
          }
        }
      }
    );

    setLiveMeetingStatus(
      "loading",
      "Đã mở phòng. Hãy chọn camera và micro để tham gia."
    );

    jitsiApi.addListener(
      "videoConferenceJoined",
      async () => {
        setLiveMeetingStatus(
          "success",
          "Bạn đã tham gia lớp học trực tuyến."
        );
        await saveMeetingAttendance(meeting, true);
      }
    );

    jitsiApi.addListener(
      "videoConferenceLeft",
      async () => {
        await saveMeetingAttendance(meeting, false);

        if (!isClosingJitsi) {
          await closeLiveClass(true);
        }
      }
    );

    jitsiApi.addListener(
      "readyToClose",
      async () => {
        if (!isClosingJitsi) {
          await closeLiveClass(true);
        }
      }
    );

    jitsiApi.addListener("cameraError", error => {
      console.error("Jitsi camera error:", error);
      toast(
        "Không mở được camera. Hãy kiểm tra quyền camera trong Windows.",
        false
      );
    });

    jitsiApi.addListener("micError", error => {
      console.error("Jitsi microphone error:", error);
      toast(
        "Không mở được micro. Hãy kiểm tra quyền micro trong Windows.",
        false
      );
    });
  } catch (error) {
    console.error("Start Jitsi error:", error);
    setLiveMeetingStatus(
      "error",
      "Không thể khởi tạo phòng học trực tuyến."
    );
    toast(
      "Lỗi mở phòng học: " +
        (error?.message || "Không xác định"),
      false
    );
  }
}

window._joinOnlineMeeting = async encodedMeetingId => {
  const meetingId = decodeURIComponent(encodedMeetingId);
  const meeting = allOnlineMeetings.find(item => item.id === meetingId);

  if (!meeting) {
    toast("Không tìm thấy lịch lớp học.", false);
    return;
  }

  const state = getMeetingState(meeting);
  const isTeacherOwner =
    currentRole === "giaovien" &&
    meeting.giaoVienId === currentUser.uid;
  const isEnrolledStudent =
    currentRole !== "giaovien" &&
    isStudentEnrolledInMeeting(meeting);

  if (!isTeacherOwner && !isEnrolledStudent) {
    toast("Bạn không thuộc lớp học này.", false);
    return;
  }

  const canJoin = isTeacherOwner
    ? state.canTeacherJoin
    : state.canStudentJoin;

  if (!canJoin) {
    if (state.key === "upcoming") {
      toast(
        "Học sinh được tham gia từ 15 phút trước giờ bắt đầu.",
        false
      );
    } else {
      toast("Lớp học hiện không thể tham gia.", false);
    }
    return;
  }

  activeOnlineMeeting = meeting;

  $("live-meeting-course").textContent =
    meeting.maHocPhan || meeting.tenHocPhan || "Học phần";
  $("live-meeting-title").textContent =
    meeting.tieuDe || "Lớp học trực tuyến";
  $("live-meeting-time").textContent =
    `${fmtOptionalDate(meeting.batDauAt)} – ${fmtOptionalDate(meeting.ketThucAt)}`;

  setPage("page-phong-hop");
  await startJitsiClass(meeting);
};

async function closeLiveClass(returnToList = true) {
  if (isClosingJitsi) return;
  isClosingJitsi = true;

  const meeting = activeOnlineMeeting;

  try {
    if (jitsiApi) {
      try {
        jitsiApi.executeCommand("hangup");
      } catch {}

      try {
        jitsiApi.dispose();
      } catch {}

      jitsiApi = null;
    }

    if (meeting) {
      await saveMeetingAttendance(meeting, false);
    }
  } finally {
    const container = $("jitsi-container");

    if (container) {
      container.innerHTML = `
        <div class="jitsi-loading">
          <span>🎥</span>
          <strong>Đã rời lớp học</strong>
          <small>Bạn có thể quay lại lịch học để tham gia phòng khác.</small>
        </div>`;
    }

    activeOnlineMeeting = null;
    isClosingJitsi = false;

    if (returnToList && currentUser) {
      setPage("page-lop-truc-tuyen");
      await loadOnlineMeetings();
    }
  }
}

$("btn-leave-live-class").onclick = async () => {
  await closeLiveClass(true);
};


/* ══════════════════════════════════════════════════════════
   TRẮC NGHIỆM (QUIZ) + CHỐNG GIAN LẬN
   ══════════════════════════════════════════════════════════ */

let teacherQuizList   = [];   // đề trắc nghiệm do giáo viên hiện tại tạo
let currentTNAttempts = [];   // bài làm đang xem trong modal kết quả (giáo viên)

let studentQuizList          = []; // đề trắc nghiệm đang mở, thuộc học phần đã ghi danh
let studentQuizAttemptCounts = {}; // quizId -> số lần học sinh đã làm
let studentQuizResults       = []; // toàn bộ bài làm của học sinh hiện tại

let quizDraftQuestions = [];  // câu hỏi đang soạn (giáo viên)

/* ── Giáo viên: soạn & quản lý đề trắc nghiệm ────────────── */

function renderTNBuilder() {
  const wrap = $("tn-builder-list");
  if (!wrap) return;

  if (!quizDraftQuestions.length) {
    wrap.innerHTML = `<div class="tn-builder-empty">Chưa có câu hỏi nào. Bấm “Thêm câu hỏi” để bắt đầu.</div>`;
    return;
  }

  wrap.innerHTML = quizDraftQuestions.map((q, i) => `
    <div class="tn-question-card">
      <div class="tn-question-card-head">
        <span>Câu ${i + 1}</span>
        <button type="button" class="btn-sm danger" data-remove="${i}">✕ Xóa câu</button>
      </div>
      <textarea class="tn-q-content" data-idx="${i}" rows="2" placeholder="Nhập nội dung câu hỏi…">${escapeHtml(q.noiDung)}</textarea>
      <div class="tn-options-grid">
        ${q.luaChon.map((opt, j) => `
          <label class="tn-option-row">
            <input type="radio" name="tn-dapan-${i}" class="tn-correct-radio" data-idx="${i}" data-opt="${j}" ${q.dapAn === j ? "checked" : ""}/>
            <input type="text" class="tn-option-input" data-idx="${i}" data-opt="${j}" placeholder="Đáp án ${String.fromCharCode(65 + j)}" value="${escapeHtml(opt)}"/>
          </label>`).join("")}
      </div>
    </div>`).join("");

  wrap.querySelectorAll(".tn-q-content").forEach(el => {
    el.oninput = () => { quizDraftQuestions[+el.dataset.idx].noiDung = el.value; };
  });
  wrap.querySelectorAll(".tn-option-input").forEach(el => {
    el.oninput = () => { quizDraftQuestions[+el.dataset.idx].luaChon[+el.dataset.opt] = el.value; };
  });
  wrap.querySelectorAll(".tn-correct-radio").forEach(el => {
    el.onchange = () => { quizDraftQuestions[+el.dataset.idx].dapAn = +el.dataset.opt; };
  });
  wrap.querySelectorAll("[data-remove]").forEach(el => {
    el.onclick = () => { quizDraftQuestions.splice(+el.dataset.remove, 1); renderTNBuilder(); };
  });
}

$("btn-them-cauhoi").onclick = () => {
  quizDraftQuestions.push({ noiDung: "", luaChon: ["", "", "", ""], dapAn: 0 });
  renderTNBuilder();
};

renderTNBuilder();

$("btn-luu-tracnghiem").onclick = async () => {
  const hocPhanId       = $("tn-hocphan").value;
  const tieuDe          = $("tn-tieude").value.trim();
  const moTa            = $("tn-mota").value.trim();
  const thoiGianPhut    = parseInt($("tn-thoigian").value, 10);
  const soLanLamToiDa   = parseInt($("tn-solan").value, 10) || 1;
  const gioiHanViPham   = parseInt($("tn-gioihanvipham").value, 10) || 3;
  const xaoTronCauHoi   = $("tn-xaotroncauhoi").checked;
  const xaoTronDapAn    = $("tn-xaotrondapan").checked;
  const hienDiemNgay    = $("tn-hiendiemngay").checked;

  if (!hocPhanId)                        { toast("Vui lòng chọn học phần.", false); return; }
  if (!tieuDe)                           { toast("Vui lòng nhập tiêu đề đề trắc nghiệm.", false); return; }
  if (!thoiGianPhut || thoiGianPhut < 1) { toast("Thời gian làm bài không hợp lệ.", false); return; }
  if (!quizDraftQuestions.length)        { toast("Vui lòng thêm ít nhất 1 câu hỏi.", false); return; }

  for (const [i, q] of quizDraftQuestions.entries()) {
    if (!q.noiDung.trim())              { toast(`Câu ${i + 1}: chưa nhập nội dung câu hỏi.`, false); return; }
    if (q.luaChon.some(o => !o.trim())) { toast(`Câu ${i + 1}: chưa nhập đủ 4 đáp án.`, false); return; }
  }

  const hp = teacherHocPhanList.find(h => h.id === hocPhanId);
  setLoading("btn-luu-tracnghiem", true, "Đang lưu…");
  try {
    await addDoc(collection(db, "trac_nghiem"), {
      hocPhanId, maHocPhan: hp?.maHocPhan || "", tenHocPhan: hp?.tenHocPhan || "",
      tieuDe, moTa,
      thoiGianPhut, soLanLamToiDa, gioiHanViPham,
      xaoTronCauHoi, xaoTronDapAn, hienDiemNgay,
      trangThai: "mo",
      cauHoi: quizDraftQuestions.map((q, i) => ({
        id: `c${i + 1}`,
        noiDung: q.noiDung.trim(),
        luaChon: q.luaChon.map(o => o.trim()),
        dapAn: q.dapAn
      })),
      giaoVienId: currentUser.uid,
      giaoVienTen: currentUserName,
      createdAt: serverTimestamp()
    });
    toast("Đã lưu đề trắc nghiệm! ✓");
    quizDraftQuestions = [];
    renderTNBuilder();
    $("tn-tieude").value = "";
    $("tn-mota").value = "";
    loadTracNghiem_GV();
  } catch (e) {
    toast("Lỗi lưu đề trắc nghiệm: " + e.message, false);
  }
  setLoading("btn-luu-tracnghiem", false);
};

async function loadTracNghiem_GV() {
  const tb = $("tb-tn-gv");
  tb.innerHTML = `<tr class="empty-row"><td colspan="7">Đang tải…</td></tr>`;
  try {
    const snap = await getDocs(query(collection(db, "trac_nghiem"), where("giaoVienId", "==", currentUser.uid)));
    teacherQuizList = newestFirst(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    renderTN_GV();
  } catch (e) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="7">Không tải được danh sách.</td></tr>`;
    toast("Lỗi tải trắc nghiệm: " + e.message, false);
  }
}

function renderTN_GV() {
  const filterId = $("tn-hocphan-filter").value;
  const list = filterId ? teacherQuizList.filter(q => q.hocPhanId === filterId) : teacherQuizList;
  const tb = $("tb-tn-gv");

  if (!list.length) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="7">Chưa có đề trắc nghiệm nào.</td></tr>`;
    return;
  }

  tb.innerHTML = list.map(q => `
    <tr>
      <td><span class="code-badge">${courseLabel({ maHocPhan: q.maHocPhan, tenHocPhan: q.tenHocPhan })}</span></td>
      <td>${escapeHtml(q.tieuDe)}</td>
      <td>${q.cauHoi?.length || 0}</td>
      <td>${q.thoiGianPhut} phút</td>
      <td><span class="tn-status-badge ${q.trangThai === "mo" ? "open" : "closed"}">${q.trangThai === "mo" ? "Đang mở" : "Đã đóng"}</span></td>
      <td><span id="tn-count-${q.id}">…</span></td>
      <td>
        <button class="btn-sm" onclick="window._toggleTN('${q.id}','${q.trangThai}')">${q.trangThai === "mo" ? "Đóng" : "Mở"}</button>
        <button class="btn-sm" onclick="window._xemKQTN('${q.id}')">Kết quả</button>
        <button class="btn-sm danger" onclick="window._xoaTN('${q.id}')">Xóa</button>
      </td>
    </tr>`).join("");

  list.forEach(async q => {
    try {
      const s = await getDocs(query(collection(db, "bai_lam_trac_nghiem"), where("quizId", "==", q.id)));
      const el = $(`tn-count-${q.id}`);
      if (el) el.textContent = s.size;
    } catch { /* bỏ qua lỗi đếm lượt nộp */ }
  });
}

$("tn-hocphan-filter").onchange = renderTN_GV;
$("btn-refresh-tn-gv").onclick  = loadTracNghiem_GV;

window._toggleTN = async (id, current) => {
  try {
    await updateDoc(doc(db, "trac_nghiem", id), { trangThai: current === "mo" ? "dong" : "mo" });
    toast(current === "mo" ? "Đã đóng đề trắc nghiệm." : "Đã mở đề trắc nghiệm.");
    loadTracNghiem_GV();
  } catch (e) { toast("Lỗi cập nhật trạng thái: " + e.message, false); }
};

window._xoaTN = async (id) => {
  if (!confirm("Xóa đề trắc nghiệm này? Toàn bộ bài làm liên quan cũng sẽ bị xóa.")) return;
  try {
    const s = await getDocs(query(collection(db, "bai_lam_trac_nghiem"), where("quizId", "==", id)));
    await Promise.all(s.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "trac_nghiem", id));
    toast("Đã xóa đề trắc nghiệm.");
    loadTracNghiem_GV();
  } catch (e) { toast("Lỗi xóa đề trắc nghiệm: " + e.message, false); }
};

function tnStatusLabel(s) {
  return ({
    binh_thuong:      "Nộp bình thường",
    het_gio:          "Hết giờ – tự nộp",
    tu_dong_vi_pham:  "Tự nộp do vi phạm"
  })[s] || "—";
}

function violationLabel(type) {
  return ({
    chuyen_tab:        "Chuyển sang tab/cửa sổ khác",
    thoat_fullscreen:  "Thoát chế độ toàn màn hình",
    mat_focus:         "Mất tiêu điểm cửa sổ",
    phim_tat_cam:      "Dùng phím tắt bị cấm",
    sao_chep:          "Cố sao chép/dán nội dung",
    chuot_phai:        "Bấm chuột phải"
  })[type] || type;
}

window._xemKQTN = async (id) => {
  const quiz = teacherQuizList.find(q => q.id === id);
  if (!quiz) return;

  $("tn-results-modal-title").textContent = "📊 Kết quả: " + quiz.tieuDe;
  $("tn-results-modal-sub").textContent   = courseLabel({ maHocPhan: quiz.maHocPhan, tenHocPhan: quiz.tenHocPhan });
  $("tb-tn-ketqua-gv").innerHTML = `<tr class="empty-row"><td colspan="8">Đang tải…</td></tr>`;
  show("tn-results-modal");

  try {
    const snap = await getDocs(query(collection(db, "bai_lam_trac_nghiem"), where("quizId", "==", id)));
    currentTNAttempts = newestFirst(snap.docs.map(d => ({ id: d.id, ...d.data() })));

    if (!currentTNAttempts.length) {
      $("tb-tn-ketqua-gv").innerHTML = `<tr class="empty-row"><td colspan="8">Chưa có học sinh nào nộp bài.</td></tr>`;
      return;
    }

    $("tb-tn-ketqua-gv").innerHTML = currentTNAttempts.map(a => `
      <tr>
        <td>${escapeHtml(a.hoTen || "—")}</td>
        <td>${escapeHtml(a.maSo || "—")}</td>
        <td>${formatScore(a.diem)}</td>
        <td>${a.soCauDung ?? "—"}/${a.tongSoCau ?? "—"}</td>
        <td>${a.tongSoViPham > 0
              ? `<span class="tn-violation-count">⚠️ ${a.tongSoViPham}</span>`
              : `<span class="tn-violation-count ok">0</span>`}</td>
        <td>${fmtDate(a.createdAt)}</td>
        <td>${tnStatusLabel(a.trangThaiNop)}</td>
        <td><button class="btn-sm" onclick="window._xemLogTN('${a.id}')">Nhật ký</button></td>
      </tr>`).join("");
  } catch (e) {
    $("tb-tn-ketqua-gv").innerHTML = `<tr class="empty-row"><td colspan="8">Lỗi tải kết quả.</td></tr>`;
    toast("Lỗi tải kết quả trắc nghiệm: " + e.message, false);
  }
};

window._xemLogTN = (attemptId) => {
  const a = currentTNAttempts.find(x => x.id === attemptId);
  if (!a) return;

  $("tn-violation-modal-sub").textContent = `${a.hoTen || "Học sinh"} — ${a.tongSoViPham || 0} vi phạm`;
  const log = a.nhatKyViPham || [];
  $("tn-violation-log-list").innerHTML = log.length
    ? log.map(l => `
        <div class="tn-log-item">
          <span class="tn-log-type">${violationLabel(l.loai)}</span>
          <span class="tn-log-time">${l.luc ? new Date(l.luc).toLocaleString("vi-VN") : "—"}</span>
        </div>`).join("")
    : `<div class="tn-log-empty">Không có vi phạm nào được ghi nhận.</div>`;

  show("tn-violation-modal");
};

$("btn-close-tn-results").onclick   = () => hide("tn-results-modal");
$("btn-close-tn-results-2").onclick = () => hide("tn-results-modal");
$("btn-close-tn-violation").onclick   = () => hide("tn-violation-modal");
$("btn-close-tn-violation-2").onclick = () => hide("tn-violation-modal");

/* ── Học sinh: danh sách & kết quả trắc nghiệm ───────────── */

async function loadTracNghiem_HS() {
  const tb = $("tb-tn-hs");
  tb.innerHTML = `<tr class="empty-row"><td colspan="6">Đang tải…</td></tr>`;

  if (!studentHocPhanList.length) {
    show("tn-hs-empty");
    tb.innerHTML = `<tr class="empty-row"><td colspan="6">Bạn chưa ghi danh học phần nào.</td></tr>`;
    $("tb-tn-ketqua-hs").innerHTML = `<tr class="empty-row"><td colspan="7">Chưa có bài làm nào.</td></tr>`;
    return;
  }
  hide("tn-hs-empty");

  try {
    const courseIds = [...new Set(studentHocPhanList.map(gd => gd.hocPhanId))];
    const chunks = [];
    for (let i = 0; i < courseIds.length; i += 10) chunks.push(courseIds.slice(i, i + 10));

    let quizzes = [];
    for (const chunk of chunks) {
      const s = await getDocs(query(collection(db, "trac_nghiem"), where("hocPhanId", "in", chunk)));
      quizzes.push(...s.docs.map(d => ({ id: d.id, ...d.data() })));
    }
    studentQuizList = newestFirst(quizzes.filter(q => q.trangThai === "mo"));

    const resSnap = await getDocs(query(collection(db, "bai_lam_trac_nghiem"), where("uid", "==", currentUser.uid)));
    studentQuizResults = newestFirst(resSnap.docs.map(d => ({ id: d.id, ...d.data() })));

    studentQuizAttemptCounts = {};
    studentQuizResults.forEach(r => {
      studentQuizAttemptCounts[r.quizId] = (studentQuizAttemptCounts[r.quizId] || 0) + 1;
    });

    renderTN_HS();
    renderTNKetQua_HS();
  } catch (e) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="6">Lỗi tải danh sách trắc nghiệm.</td></tr>`;
    toast("Lỗi tải trắc nghiệm: " + e.message, false);
  }
}

function renderTN_HS() {
  const tb = $("tb-tn-hs");
  if (!studentQuizList.length) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="6">Hiện chưa có đề trắc nghiệm nào đang mở.</td></tr>`;
    return;
  }

  tb.innerHTML = studentQuizList.map(q => {
    const done = studentQuizAttemptCounts[q.id] || 0;
    const max  = q.soLanLamToiDa || 1;
    const canStart = done < max;
    return `
    <tr>
      <td><span class="code-badge">${courseLabel({ maHocPhan: q.maHocPhan, tenHocPhan: q.tenHocPhan })}</span></td>
      <td>${escapeHtml(q.tieuDe)}</td>
      <td>${q.cauHoi?.length || 0}</td>
      <td>${q.thoiGianPhut} phút</td>
      <td>${done}/${max}</td>
      <td><button class="btn-sm student" ${canStart ? "" : "disabled"} onclick="window._batDauTN('${q.id}')">${canStart ? "▶ Bắt đầu làm bài" : "Hết lượt"}</button></td>
    </tr>`;
  }).join("");
}

function renderTNKetQua_HS() {
  const tb = $("tb-tn-ketqua-hs");
  if (!studentQuizResults.length) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="7">Chưa có bài làm nào.</td></tr>`;
    return;
  }
  tb.innerHTML = studentQuizResults.map(r => `
    <tr>
      <td><span class="code-badge">${courseLabel({ maHocPhan: r.maHocPhan, tenHocPhan: r.tenHocPhan })}</span></td>
      <td>${escapeHtml(r.tieuDe)}</td>
      <td>${r.hienDiemNgay === false ? "Chờ công bố" : formatScore(r.diem)}</td>
      <td>${r.soCauDung ?? "—"}/${r.tongSoCau ?? "—"}</td>
      <td>${r.tongSoViPham || 0}</td>
      <td>${fmtDate(r.createdAt)}</td>
      <td>${tnStatusLabel(r.trangThaiNop)}</td>
    </tr>`).join("");
}

$("btn-refresh-tn-hs").onclick = loadTracNghiem_HS;

window._batDauTN = async (quizId) => {
  const quiz = studentQuizList.find(q => q.id === quizId);
  if (!quiz) { toast("Không tìm thấy đề trắc nghiệm.", false); return; }

  const done = studentQuizAttemptCounts[quizId] || 0;
  if (done >= (quiz.soLanLamToiDa || 1)) { toast("Bạn đã hết lượt làm bài cho đề này.", false); return; }

  const confirmed = confirm(
    `Bắt đầu làm "${quiz.tieuDe}"?\n\n` +
    `Thời gian: ${quiz.thoiGianPhut} phút. Bài làm sẽ được giám sát chống gian lận ` +
    `(toàn màn hình, không chuyển tab, không sao chép). Vi phạm quá ${quiz.gioiHanViPham || 3} lần ` +
    `sẽ tự động nộp bài.`
  );
  if (!confirmed) return;

  await startQuizAttempt(quiz);
};

/* ── Học sinh: làm bài trắc nghiệm (chống gian lận) ──────── */

let activeQuiz              = null;
let quizAttemptQuestions    = [];
let quizAnswers             = {};
let quizTimerInterval       = null;
let quizRemainingSeconds    = 0;
let quizViolationLog        = [];
let quizTotalViolations     = 0;
let quizSubmitting          = false;
let quizStartedAt           = null;
let quizFullscreenExpected  = false;
let quizBlurTimeout         = null;

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildAttemptQuestions(quiz) {
  let list = (quiz.cauHoi || []).map((q, i) => ({
    id: q.id || `c${i + 1}`,
    noiDung: q.noiDung,
    options: (q.luaChon || []).map((text, idx) => ({ text, correct: idx === q.dapAn }))
  }));
  if (quiz.xaoTronCauHoi) list = shuffleArray(list);
  if (quiz.xaoTronDapAn)  list = list.map(q => ({ ...q, options: shuffleArray(q.options) }));
  return list;
}

function renderQuizQuestionsLegacy() {
  const wrap = $("quiz-questions-list");
  wrap.innerHTML = quizAttemptQuestions.map((q, i) => `
    <div class="quiz-question-card">
      <div class="quiz-question-text"><span class="quiz-question-index">Câu ${i + 1}.</span> ${escapeHtml(q.noiDung)}</div>
      <div class="quiz-options">
        ${q.options.map((opt, j) => `
          <label class="quiz-option">
            <input type="radio" name="quiz-q-${q.id}" data-qid="${q.id}" data-opt="${j}"/>
            <span>${escapeHtml(opt.text)}</span>
          </label>`).join("")}
      </div>
    </div>`).join("");

  wrap.querySelectorAll('input[type="radio"]').forEach(el => {
    el.onchange = () => {
      quizAnswers[el.dataset.qid] = +el.dataset.opt;
      updateQuizProgress();
    };
  });
}

function updateQuizProgressLegacy() {
  const answered = Object.keys(quizAnswers).length;
  $("quiz-progress-note").textContent = `Đã trả lời ${answered}/${quizAttemptQuestions.length} câu`;
}

function updateQuizTimerDisplayLegacy() {
  const s  = Math.max(0, quizRemainingSeconds);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const el = $("quiz-timer");
  el.textContent = `${mm}:${ss}`;
  el.classList.toggle("danger", s <= 60);
}

async function requestQuizFullscreen() {
  quizFullscreenExpected = true;
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch (e) {
    console.warn("Không thể vào chế độ toàn màn hình:", e);
  }
}

function updateViolationBadgeLegacy() {
  const badge = $("quiz-violation-badge");
  if (quizTotalViolations > 0) {
    badge.textContent = `⚠️ Vi phạm: ${quizTotalViolations}/${activeQuiz?.gioiHanViPham || 3}`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function showQuizWarning(message) {
  const banner = $("quiz-warning-banner");
  banner.textContent = message;
  banner.classList.remove("hidden");
  clearTimeout(banner._t);
  banner._t = setTimeout(() => banner.classList.add("hidden"), 5000);
}

function logQuizViolationLegacy(type, message) {
  if (quizSubmitting) return;
  quizViolationLog.push({ loai: type, luc: new Date().toISOString() });
  quizTotalViolations++;
  updateViolationBadge();
  showQuizWarning(message);

  const limit = activeQuiz?.gioiHanViPham || 3;
  if (quizTotalViolations >= limit) submitQuizAttempt("tu_dong_vi_pham");
}

function handleVisibilityChange() {
  if (document.hidden && !quizSubmitting) {
    logQuizViolation("chuyen_tab", "⚠️ Phát hiện chuyển sang tab/ứng dụng khác! Vi phạm đã được ghi lại.");
  }
}

function handleWindowBlur() {
  if (quizSubmitting) return;
  clearTimeout(quizBlurTimeout);
  quizBlurTimeout = setTimeout(() => {
    if (!document.hasFocus() && !quizSubmitting) {
      logQuizViolation("mat_focus", "⚠️ Cửa sổ làm bài mất tiêu điểm! Vi phạm đã được ghi lại.");
    }
  }, 400);
}

function handleFullscreenChange() {
  const inFullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  if (!inFullscreen && quizFullscreenExpected && !quizSubmitting) {
    logQuizViolation("thoat_fullscreen", "⚠️ Bạn đã thoát chế độ toàn màn hình! Vi phạm đã được ghi lại.");
    setTimeout(() => { if (!quizSubmitting) requestQuizFullscreen(); }, 500);
  }
}

function handleContextMenu(e) {
  if ($("quiz-lockdown").classList.contains("hidden")) return;
  e.preventDefault();
  logQuizViolation("chuot_phai", "⚠️ Chuột phải bị vô hiệu hóa trong khi làm bài.");
}

function handleQuizKeydown(e) {
  const key = (e.key || "").toUpperCase();
  const isDevtoolsCombo = (e.ctrlKey || e.metaKey) && e.shiftKey && ["I", "J", "C"].includes(key);
  const isViewSource     = (e.ctrlKey || e.metaKey) && key === "U";
  const isPrint          = (e.ctrlKey || e.metaKey) && key === "P";
  const isCopyPaste      = (e.ctrlKey || e.metaKey) && ["C", "V", "X"].includes(key);

  if (e.key === "F12" || isDevtoolsCombo || isViewSource) {
    e.preventDefault();
    logQuizViolation("phim_tat_cam", "⚠️ Phím tắt bị cấm trong khi làm bài.");
    return;
  }
  if (isPrint) {
    e.preventDefault();
    logQuizViolation("phim_tat_cam", "⚠️ Không được in màn hình khi làm bài.");
    return;
  }
  if (isCopyPaste) {
    e.preventDefault();
    logQuizViolation("sao_chep", "⚠️ Sao chép/dán bị vô hiệu hóa trong khi làm bài.");
  }
}

function handleQuizCopyCutPaste(e) {
  e.preventDefault();
  logQuizViolation("sao_chep", "⚠️ Sao chép/dán nội dung bị chặn trong khi làm bài.");
}

function attachAntiCheatListeners() {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("blur", handleWindowBlur);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
  document.addEventListener("contextmenu", handleContextMenu);
  document.addEventListener("keydown", handleQuizKeydown, true);
  document.addEventListener("copy", handleQuizCopyCutPaste);
  document.addEventListener("cut", handleQuizCopyCutPaste);
  document.addEventListener("paste", handleQuizCopyCutPaste);
}

function detachAntiCheatListeners() {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("blur", handleWindowBlur);
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
  document.removeEventListener("contextmenu", handleContextMenu);
  document.removeEventListener("keydown", handleQuizKeydown, true);
  document.removeEventListener("copy", handleQuizCopyCutPaste);
  document.removeEventListener("cut", handleQuizCopyCutPaste);
  document.removeEventListener("paste", handleQuizCopyCutPaste);
}

async function startQuizAttemptLegacy(quiz) {
  activeQuiz           = quiz;
  quizAttemptQuestions = buildAttemptQuestions(quiz);
  quizAnswers          = {};
  quizViolationLog     = [];
  quizTotalViolations  = 0;
  quizSubmitting       = false;
  quizStartedAt        = new Date();
  quizRemainingSeconds = quiz.thoiGianPhut * 60;

  $("quiz-lockdown-course").textContent = courseLabel({ maHocPhan: quiz.maHocPhan, tenHocPhan: quiz.tenHocPhan });
  $("quiz-lockdown-title").textContent  = quiz.tieuDe;
  hide("quiz-warning-banner");
  $("quiz-warning-banner").textContent = "";
  updateViolationBadge();
  renderQuizQuestions();
  updateQuizProgress();
  updateQuizTimerDisplay();

  show("quiz-lockdown");
  document.body.classList.add("quiz-locked");

  await requestQuizFullscreen();
  attachAntiCheatListeners();

  quizTimerInterval = setInterval(() => {
    quizRemainingSeconds--;
    updateQuizTimerDisplay();
    if (quizRemainingSeconds <= 0) submitQuizAttempt("het_gio");
  }, 1000);

  window.onbeforeunload = (e) => {
    e.preventDefault();
    e.returnValue = "";
    return "";
  };
}

async function submitQuizAttemptLegacy(reason) {
  if (quizSubmitting) return;
  quizSubmitting = true;
  quizFullscreenExpected = false;

  clearInterval(quizTimerInterval);
  quizTimerInterval = null;
  detachAntiCheatListeners();
  window.onbeforeunload = null;

  try {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  } catch { /* bỏ qua */ }

  const soCauDung = quizAttemptQuestions.filter(q => {
    const chosen = quizAnswers[q.id];
    return chosen !== undefined && q.options[chosen]?.correct;
  }).length;
  const tongSoCau = quizAttemptQuestions.length;
  const diem = tongSoCau ? Math.round((soCauDung / tongSoCau) * 1000) / 100 : 0;

  const quiz = activeQuiz;
  try {
    await addDoc(collection(db, "bai_lam_trac_nghiem"), {
      quizId: quiz.id, hocPhanId: quiz.hocPhanId,
      maHocPhan: quiz.maHocPhan || "", tenHocPhan: quiz.tenHocPhan || "",
      tieuDe: quiz.tieuDe,
      uid: currentUser.uid, hoTen: currentUserName, email: currentUser.email || "",
      diem, soCauDung, tongSoCau,
      trangThaiNop: reason,
      tongSoViPham: quizTotalViolations,
      nhatKyViPham: quizViolationLog,
      hienDiemNgay: quiz.hienDiemNgay !== false,
      batDauAtClient: quizStartedAt.toISOString(),
      nopAtClient: new Date().toISOString(),
      createdAt: serverTimestamp()
    });

    if (reason === "tu_dong_vi_pham") {
      toast(`Bài làm đã được tự động nộp do vượt quá số lần vi phạm cho phép (${quizTotalViolations} vi phạm).`, false);
    } else if (reason === "het_gio") {
      toast("Đã hết giờ làm bài — bài làm đã được tự động nộp.");
    } else {
      toast(quiz.hienDiemNgay !== false ? `Nộp bài thành công! Điểm: ${diem}/10` : "Nộp bài thành công! Điểm sẽ được công bố sau.");
    }
  } catch (e) {
    toast("Lỗi khi nộp bài: " + e.message, false);
  }

  hide("quiz-lockdown");
  document.body.classList.remove("quiz-locked");
  activeQuiz = null;
  quizAttemptQuestions = [];
  quizAnswers = {};

  if (currentUser) loadTracNghiem_HS();
}

$("btn-nop-tracnghiem").onclick = () => {
  const answered = Object.keys(quizAnswers).length;
  const total = quizAttemptQuestions.length;
  const msg = answered < total
    ? `Bạn mới trả lời ${answered}/${total} câu. Vẫn nộp bài?`
    : "Nộp bài làm ngay bây giờ?";
  if (confirm(msg)) submitQuizAttempt("binh_thuong");
};



/* ── Bạn bè và nhắn tin thời gian thực ─────────────────────── */
function socialPairId(uidA, uidB) {
  return [String(uidA || ""), String(uidB || "")].sort().join("__");
}

function socialInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

function socialRoleLabel(role) {
  return role === "admin" ? "Quản trị viên" : role === "giaovien" ? "Giáo viên" : "Học sinh";
}

function socialDate(value) {
  const date = valueToDate(value);
  if (!date) return "Vừa xong";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return "Vừa xong";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút`;
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

function socialMessageTime(value, fallback) {
  const date = valueToDate(value) || valueToDate(fallback);
  if (!date) return "Đang gửi…";
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function socialOtherId(friendship) {
  return friendship?.participants?.find(uid => uid !== currentUser?.uid) || "";
}

function socialFriendshipWith(uid) {
  return socialFriendships.find(item => item.participants?.includes(uid)) || null;
}

function socialFriendProfile(friendship) {
  const uid = socialOtherId(friendship);
  const cached = socialPublicProfiles.get(uid);
  if (cached) return cached;
  const isSender = friendship?.senderId === uid;
  return {
    uid,
    hoTen: isSender ? friendship.senderName : friendship.receiverName,
    role: isSender ? friendship.senderRole : friendship.receiverRole
  };
}

function resetSocialState() {
  socialFriendships = [];
  socialConversations = new Map();
  socialPublicProfiles = new Map();
  socialSelectedFriend = null;
  socialPendingCount = 0;
  socialUnreadCount = 0;
  socialInitializedUid = null;
  classGroups = [];
  selectedClassGroup = null;
  classGroupUnreadCount = 0;
  activeSocialMode = "private";
  classGroupsSyncPromise = null;
  updateSocialBadges();
}

function stopSocialListeners() {
  socialFriendshipUnsubscribe?.();
  socialConversationUnsubscribe?.();
  socialMessagesUnsubscribe?.();
  classGroupUnsubscribe?.();
  classGroupMessagesUnsubscribe?.();
  socialFriendshipUnsubscribe = null;
  socialConversationUnsubscribe = null;
  socialMessagesUnsubscribe = null;
  classGroupUnsubscribe = null;
  classGroupMessagesUnsubscribe = null;
}

async function ensureSocialPublicProfile(userData = {}) {
  if (!currentUser) return;
  const hoTen = userData.hoTen || currentUserName || currentUser.email || "Người dùng";
  await setDoc(doc(db, "danh_ba_cong_khai", currentUser.uid), {
    uid: currentUser.uid,
    hoTen,
    hoTenKey: normalizeCourseName(hoTen),
    role: currentRole,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function initializeSocialForUser(userData = {}) {
  if (!currentUser || socialInitializedUid === currentUser.uid) return;
  stopSocialListeners();
  resetSocialState();
  socialInitializedUid = currentUser.uid;
  await ensureSocialPublicProfile(userData);
  startSocialOverviewListeners();
  startClassGroupOverviewListener();
  ensureClassGroupsForCurrentUser().catch(error => {
    console.error("Không thể đồng bộ nhóm chat lớp:", error);
  });
}

function startSocialOverviewListeners() {
  if (!currentUser) return;
  socialFriendshipUnsubscribe?.();
  socialConversationUnsubscribe?.();

  const friendshipsQuery = query(
    collection(db, "ket_ban"),
    where("participants", "array-contains", currentUser.uid)
  );
  socialFriendshipUnsubscribe = onSnapshot(friendshipsQuery, snapshot => {
    socialFriendships = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    updateSocialDerivedState();
  }, error => {
    console.error("Friendship listener error:", error);
    renderSocialPermissionError(error);
  });

  const conversationsQuery = query(
    collection(db, "tro_chuyen"),
    where("participants", "array-contains", currentUser.uid)
  );
  socialConversationUnsubscribe = onSnapshot(conversationsQuery, snapshot => {
    socialConversations = new Map(snapshot.docs.map(item => [item.id, { id: item.id, ...item.data() }]));
    updateSocialDerivedState();
  }, error => {
    console.error("Conversation listener error:", error);
  });
}

function updateSocialDerivedState() {
  if (!currentUser) return;
  const incoming = socialFriendships.filter(item => item.status === "pending" && item.receiverId === currentUser.uid);
  socialPendingCount = incoming.length;

  socialUnreadCount = [...socialConversations.values()].filter(conversation => {
    if (!conversation.lastMessage || !conversation.lastSenderId) return false;
    if (conversation.lastSenderId === currentUser.uid) return false;
    const updated = timestampMs(conversation.updatedAt);
    const read = timestampMs(conversation.readAt?.[currentUser.uid]);
    return updated > read;
  }).length;

  updateSocialBadges();
  if ($("page-ban-be")?.classList.contains("active")) renderSocialHub();
  renderPremiumNotifications();
}

function updateSocialBadges() {
  const total = socialPendingCount + socialUnreadCount + classGroupUnreadCount;
  const badge = $("social-nav-badge");
  if (badge) {
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.classList.toggle("hidden", total === 0);
  }
  $("social-incoming-count") && ($("social-incoming-count").textContent = String(socialPendingCount));
}

function renderSocialPermissionError(error) {
  const target = $("social-friend-list");
  if (!target) return;
  const isPermission = error?.code === "permission-denied" || error?.code === "firestore/permission-denied";
  target.innerHTML = `<div class="social-empty-state error"><span>🔐</span><strong>${isPermission ? "Firestore chưa cấp quyền" : "Không tải được dữ liệu"}</strong><small>${isPermission ? "Hãy Publish phần Rules đi kèm bộ cập nhật này." : escapeHtml(error?.message || "Vui lòng thử lại.")}</small></div>`;
}

async function loadSocialHub() {
  if (!currentUser) return;
  if (socialInitializedUid !== currentUser.uid) await initializeSocialForUser({ hoTen: currentUserName, role: currentRole });
  renderSocialHub();
  renderClassGroupList();
}

function renderSocialHub() {
  renderSocialRequests();
  renderSocialFriends();
  const queryText = $("social-user-search")?.value.trim() || "";
  if (queryText.length >= 2) searchSocialUsers(queryText, false);
}

function socialPersonCard(profile, actionHtml = "", extraClass = "") {
  const role = socialRoleLabel(profile.role);
  return `<article class="social-person-card ${extraClass}" data-social-uid="${escapeHtml(profile.uid)}">
    <div class="social-avatar ${profile.role === "giaovien" ? "teacher" : "student"}">${escapeHtml(socialInitials(profile.hoTen))}</div>
    <div class="social-person-copy"><strong>${escapeHtml(profile.hoTen || "Người dùng")}</strong><span>${escapeHtml(role)}</span></div>
    <div class="social-person-actions">${actionHtml}</div>
  </article>`;
}

function renderSocialRequests() {
  if (!currentUser) return;
  const incoming = socialFriendships
    .filter(item => item.status === "pending" && item.receiverId === currentUser.uid)
    .sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
  const outgoing = socialFriendships
    .filter(item => item.status === "pending" && item.senderId === currentUser.uid)
    .sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));

  $("social-incoming-count").textContent = String(incoming.length);
  $("social-outgoing-count").textContent = String(outgoing.length);

  const incomingList = $("social-incoming-list");
  const outgoingList = $("social-outgoing-list");
  if (incomingList) {
    incomingList.innerHTML = incoming.length ? incoming.map(item => {
      const profile = socialFriendProfile(item);
      return socialPersonCard(profile, `
        <button type="button" class="social-mini-button primary" data-social-action="accept" data-social-id="${escapeHtml(item.id)}">Chấp nhận</button>
        <button type="button" class="social-mini-button" data-social-action="decline" data-social-id="${escapeHtml(item.id)}">Từ chối</button>`, "request");
    }).join("") : `<div class="social-empty-state compact"><span>📭</span><strong>Không có lời mời mới</strong><small>Lời mời đến sẽ xuất hiện tại đây.</small></div>`;
  }
  if (outgoingList) {
    outgoingList.innerHTML = outgoing.length ? outgoing.map(item => {
      const profile = socialFriendProfile(item);
      return socialPersonCard(profile, `<button type="button" class="social-mini-button" data-social-action="cancel" data-social-id="${escapeHtml(item.id)}">Hủy lời mời</button>`, "request");
    }).join("") : `<div class="social-empty-state compact"><span>✉️</span><strong>Chưa gửi lời mời nào</strong><small>Tìm người dùng ở phía trên để kết bạn.</small></div>`;
  }

  document.querySelectorAll("[data-social-action='accept']").forEach(button => button.onclick = () => acceptSocialRequest(button.dataset.socialId));
  document.querySelectorAll("[data-social-action='decline']").forEach(button => button.onclick = () => removeSocialRelationship(button.dataset.socialId, "Đã từ chối lời mời."));
  document.querySelectorAll("[data-social-action='cancel']").forEach(button => button.onclick = () => removeSocialRelationship(button.dataset.socialId, "Đã hủy lời mời."));
}

function acceptedSocialFriends() {
  return socialFriendships
    .filter(item => item.status === "accepted")
    .map(item => ({ friendship: item, profile: socialFriendProfile(item) }))
    .filter(item => item.profile.uid)
    .sort((a, b) => {
      const convoA = socialConversations.get(a.friendship.id);
      const convoB = socialConversations.get(b.friendship.id);
      const timeDiff = timestampMs(convoB?.updatedAt) - timestampMs(convoA?.updatedAt);
      return timeDiff || String(a.profile.hoTen).localeCompare(String(b.profile.hoTen), "vi");
    });
}

function renderSocialFriends() {
  const list = $("social-friend-list");
  if (!list || !currentUser) return;
  const filter = normalizeCourseName($("social-friend-filter")?.value || "");
  const allFriends = acceptedSocialFriends();
  const friends = allFriends.filter(item => !filter || normalizeCourseName(item.profile.hoTen).includes(filter));
  $("social-friend-count").textContent = String(allFriends.length);

  if (!friends.length) {
    list.innerHTML = `<div class="social-empty-state compact"><span>${allFriends.length ? "⌕" : "👥"}</span><strong>${allFriends.length ? "Không tìm thấy bạn bè" : "Chưa có bạn bè"}</strong><small>${allFriends.length ? "Thử một tên khác." : "Tìm một người và gửi lời mời kết bạn."}</small></div>`;
    return;
  }

  list.innerHTML = friends.map(({ friendship, profile }) => {
    const conversation = socialConversations.get(friendship.id);
    const unread = Boolean(conversation?.lastMessage && conversation?.lastSenderId) && conversation.lastSenderId !== currentUser.uid && timestampMs(conversation.updatedAt) > timestampMs(conversation.readAt?.[currentUser.uid]);
    const active = socialSelectedFriend?.uid === profile.uid;
    return `<button type="button" class="social-friend-row ${active ? "active" : ""}" data-social-open-chat="${escapeHtml(profile.uid)}" data-social-friendship="${escapeHtml(friendship.id)}">
      <div class="social-avatar ${profile.role === "giaovien" ? "teacher" : "student"}">${escapeHtml(socialInitials(profile.hoTen))}</div>
      <div class="social-friend-copy">
        <div><strong>${escapeHtml(profile.hoTen)}</strong><time>${conversation ? escapeHtml(socialDate(conversation.updatedAt)) : ""}</time></div>
        <span class="${unread ? "unread" : ""}">${escapeHtml(conversation?.lastMessage || socialRoleLabel(profile.role))}</span>
      </div>
      ${unread ? `<i class="social-unread-dot" title="Tin nhắn chưa đọc"></i>` : ""}
    </button>`;
  }).join("");

  list.querySelectorAll("[data-social-open-chat]").forEach(button => {
    button.onclick = () => openSocialChat(button.dataset.socialOpenChat, button.dataset.socialFriendship);
  });
}

async function loadSocialProfiles(force = false) {
  if (socialPublicProfiles.size && !force) return [...socialPublicProfiles.values()];
  const snapshot = await getDocs(collection(db, "danh_ba_cong_khai"));
  socialPublicProfiles = new Map(snapshot.docs.map(item => [item.id, { uid: item.id, ...item.data() }]));
  return [...socialPublicProfiles.values()];
}

async function searchSocialUsers(rawQuery, showLoading = true) {
  const input = $("social-user-search");
  const resultBox = $("social-search-results");
  const status = $("social-search-status");
  if (!input || !resultBox || !status || !currentUser) return;
  const key = normalizeCourseName(rawQuery);
  $("btn-clear-social-search")?.classList.toggle("hidden", !key);

  if (key.length < 2) {
    resultBox.innerHTML = "";
    status.textContent = "Nhập ít nhất 2 ký tự để bắt đầu tìm kiếm.";
    return;
  }

  if (showLoading) {
    status.textContent = "Đang tìm người dùng…";
    resultBox.innerHTML = `<div class="social-list-loading"><span></span><span></span><span></span></div>`;
  }

  try {
    const roleFilter = $("social-role-filter")?.value || "all";
    const profiles = await loadSocialProfiles(false);
    const matches = profiles
      .filter(profile => profile.uid !== currentUser.uid)
      .filter(profile => normalizeCourseName(profile.hoTen).includes(key))
      .filter(profile => roleFilter === "all" || profile.role === roleFilter)
      .slice(0, 30);

    status.textContent = matches.length ? `Tìm thấy ${matches.length} người phù hợp.` : "Không tìm thấy người dùng phù hợp.";
    resultBox.innerHTML = matches.map(profile => {
      const relation = socialFriendshipWith(profile.uid);
      let action = `<button type="button" class="social-mini-button primary" data-social-add="${escapeHtml(profile.uid)}">Kết bạn</button>`;
      if (relation?.status === "accepted") {
        action = `<button type="button" class="social-mini-button primary" data-social-message="${escapeHtml(profile.uid)}" data-social-friendship="${escapeHtml(relation.id)}">Nhắn tin</button>`;
      } else if (relation?.status === "pending" && relation.senderId === currentUser.uid) {
        action = `<button type="button" class="social-mini-button" disabled>Đã gửi</button>`;
      } else if (relation?.status === "pending" && relation.receiverId === currentUser.uid) {
        action = `<button type="button" class="social-mini-button primary" data-social-accept-search="${escapeHtml(relation.id)}">Chấp nhận</button>`;
      }
      return socialPersonCard(profile, action);
    }).join("");

    resultBox.querySelectorAll("[data-social-add]").forEach(button => button.onclick = () => sendSocialFriendRequest(button.dataset.socialAdd));
    resultBox.querySelectorAll("[data-social-message]").forEach(button => button.onclick = () => openSocialChat(button.dataset.socialMessage, button.dataset.socialFriendship));
    resultBox.querySelectorAll("[data-social-accept-search]").forEach(button => button.onclick = () => acceptSocialRequest(button.dataset.socialAcceptSearch));
  } catch (error) {
    console.error("Search social users error:", error);
    status.textContent = "Không thể tìm người dùng.";
    resultBox.innerHTML = `<div class="social-empty-state error compact"><span>!</span><strong>Lỗi tìm kiếm</strong><small>${escapeHtml(errMsg(error.code, error.message))}</small></div>`;
  }
}

async function sendSocialFriendRequest(targetUid) {
  if (!currentUser || !targetUid || targetUid === currentUser.uid) return;
  const profile = socialPublicProfiles.get(targetUid);
  if (!profile) return toast("Không tìm thấy hồ sơ người dùng.", false);
  const pairId = socialPairId(currentUser.uid, targetUid);
  const existing = socialFriendships.find(item => item.id === pairId);
  if (existing?.status === "accepted") return openSocialChat(targetUid, pairId);
  if (existing?.status === "pending") {
    if (existing.receiverId === currentUser.uid) return acceptSocialRequest(existing.id);
    return toast("Bạn đã gửi lời mời cho người này.");
  }

  try {
    await setDoc(doc(db, "ket_ban", pairId), {
      participants: [currentUser.uid, targetUid].sort(),
      senderId: currentUser.uid,
      receiverId: targetUid,
      senderName: currentUserName,
      senderRole: currentRole,
      receiverName: profile.hoTen,
      receiverRole: profile.role,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    toast(`Đã gửi lời mời kết bạn đến ${profile.hoTen}.`);
    searchSocialUsers($("social-user-search")?.value || "", false);
  } catch (error) {
    toast("Không gửi được lời mời: " + errMsg(error.code, error.message), false);
  }
}

async function acceptSocialRequest(friendshipId) {
  const friendship = socialFriendships.find(item => item.id === friendshipId);
  if (!friendship || friendship.receiverId !== currentUser?.uid) return;
  try {
    await updateDoc(doc(db, "ket_ban", friendshipId), {
      status: "accepted",
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await setDoc(doc(db, "tro_chuyen", friendshipId), {
      participants: friendship.participants,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: "",
      lastSenderId: "",
      readAt: { [currentUser.uid]: serverTimestamp() }
    }, { merge: true });
    toast("Đã chấp nhận lời mời kết bạn.");
    searchSocialUsers($("social-user-search")?.value || "", false);
  } catch (error) {
    toast("Không thể chấp nhận lời mời: " + errMsg(error.code, error.message), false);
  }
}

async function removeSocialRelationship(friendshipId, successMessage = "Đã cập nhật lời mời.") {
  try {
    await deleteDoc(doc(db, "ket_ban", friendshipId));
    if (socialSelectedFriend && socialPairId(currentUser.uid, socialSelectedFriend.uid) === friendshipId) closeSocialChat();
    toast(successMessage);
    searchSocialUsers($("social-user-search")?.value || "", false);
  } catch (error) {
    toast("Không thể thực hiện: " + errMsg(error.code, error.message), false);
  }
}

async function openSocialChat(uid, friendshipId = socialPairId(currentUser?.uid, uid)) {
  if (!currentUser || !uid) return;
  const friendship = socialFriendships.find(item => item.id === friendshipId && item.status === "accepted");
  if (!friendship) return toast("Bạn chỉ có thể nhắn tin với bạn bè đã chấp nhận.", false);
  const profile = socialPublicProfiles.get(uid) || socialFriendProfile(friendship);
  socialSelectedFriend = profile;

  $("social-chat-empty")?.classList.add("hidden");
  $("social-chat-active")?.classList.remove("hidden");
  $("social-chat-avatar").textContent = socialInitials(profile.hoTen);
  $("social-chat-avatar").className = `social-avatar large ${profile.role === "giaovien" ? "teacher" : "student"}`;
  $("social-chat-name").textContent = profile.hoTen;
  $("social-chat-role").textContent = socialRoleLabel(profile.role);
  $("social-message-input").value = "";
  autoResizeSocialComposer();
  renderSocialFriends();
  startSocialMessageListener(friendshipId);
  await markSocialConversationRead(friendshipId, friendship.participants);
  if (window.innerWidth <= 920) $("page-ban-be")?.classList.add("social-chat-mobile-open");
}

function closeSocialChat() {
  socialMessagesUnsubscribe?.();
  socialMessagesUnsubscribe = null;
  socialSelectedFriend = null;
  $("social-chat-active")?.classList.add("hidden");
  $("social-chat-empty")?.classList.remove("hidden");
  $("page-ban-be")?.classList.remove("social-chat-mobile-open");
  renderSocialFriends();
}

function startSocialMessageListener(conversationId) {
  socialMessagesUnsubscribe?.();
  const messagesQuery = query(
    collection(db, "tro_chuyen", conversationId, "tin_nhan"),
    orderBy("createdAt", "desc"),
    limit(300)
  );
  socialMessagesUnsubscribe = onSnapshot(messagesQuery, snapshot => {
    const messages = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).reverse();
    renderSocialMessages(messages);
    const friendship = socialFriendships.find(item => item.id === conversationId);
    markSocialConversationRead(conversationId, friendship?.participants || [currentUser.uid, socialSelectedFriend?.uid].filter(Boolean));
  }, error => {
    console.error("Message listener error:", error);
    $("social-message-list").innerHTML = `<div class="social-empty-state error"><span>!</span><strong>Không tải được tin nhắn</strong><small>${escapeHtml(errMsg(error.code, error.message))}</small></div>`;
  });
}

function renderSocialMessages(messages) {
  const list = $("social-message-list");
  if (!list || !currentUser) return;
  if (!messages.length) {
    list.innerHTML = `<div class="social-conversation-start"><span>👋</span><strong>Hai bạn đã kết nối</strong><p>Hãy gửi lời chào đầu tiên cho ${escapeHtml(socialSelectedFriend?.hoTen || "người bạn này")}.</p></div>`;
    return;
  }

  let lastDate = "";
  list.innerHTML = messages.map(message => {
    const mine = message.senderId === currentUser.uid;
    const date = valueToDate(message.createdAt) || valueToDate(message.sentAtClient);
    const dateKey = date ? date.toDateString() : "";
    let separator = "";
    if (dateKey && dateKey !== lastDate) {
      lastDate = dateKey;
      separator = `<div class="social-message-date">${escapeHtml(date.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" }))}</div>`;
    }
    return `${separator}<div class="social-message-row ${mine ? "mine" : "theirs"}">
      ${mine ? "" : `<div class="social-avatar tiny">${escapeHtml(socialInitials(socialSelectedFriend?.hoTen))}</div>`}
      <div class="social-message-bubble"><p>${escapeHtml(message.text)}</p><time>${escapeHtml(socialMessageTime(message.createdAt, message.sentAtClient))}</time></div>
    </div>`;
  }).join("");
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

async function markSocialConversationRead(conversationId, participants) {
  if (!currentUser || !conversationId || !participants?.length) return;
  try {
    const conversationRef = doc(db, "tro_chuyen", conversationId);
    await setDoc(conversationRef, {
      participants: [...participants].sort(),
      createdAt: socialConversations.get(conversationId)?.createdAt || serverTimestamp(),
      readAt: { [currentUser.uid]: serverTimestamp() }
    }, { merge: true });
  } catch (error) {
    console.warn("Không thể đánh dấu đã đọc:", error);
  }
}

async function sendSocialMessage() {
  const input = $("social-message-input");
  if (!currentUser || !socialSelectedFriend || !input) return;
  const text = input.value.trim();
  if (!text) return;
  if (text.length > 2000) return toast("Tin nhắn tối đa 2000 ký tự.", false);

  const conversationId = socialPairId(currentUser.uid, socialSelectedFriend.uid);
  const friendship = socialFriendships.find(item => item.id === conversationId && item.status === "accepted");
  if (!friendship) return toast("Quan hệ bạn bè không còn tồn tại.", false);

  const sendButton = $("btn-send-social-message");
  sendButton.disabled = true;
  const originalText = text;
  input.value = "";
  autoResizeSocialComposer();
  try {
    const conversationRef = doc(db, "tro_chuyen", conversationId);
    await setDoc(conversationRef, {
      participants: friendship.participants,
      lastMessage: originalText.slice(0, 160),
      lastSenderId: currentUser.uid,
      updatedAt: serverTimestamp(),
      readAt: { [currentUser.uid]: serverTimestamp() }
    }, { merge: true });
    await addDoc(collection(db, "tro_chuyen", conversationId, "tin_nhan"), {
      senderId: currentUser.uid,
      receiverId: socialSelectedFriend.uid,
      text: originalText,
      sentAtClient: new Date().toISOString(),
      createdAt: serverTimestamp()
    });
  } catch (error) {
    input.value = originalText;
    autoResizeSocialComposer();
    toast("Không gửi được tin nhắn: " + errMsg(error.code, error.message), false);
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
}

function autoResizeSocialComposer() {
  const input = $("social-message-input");
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  $("social-message-counter").textContent = `${input.value.length}/2000`;
}

(function initSocialUI() {
  $("social-user-search")?.addEventListener("input", event => {
    clearTimeout(socialSearchTimer);
    const value = event.target.value;
    $("btn-clear-social-search")?.classList.toggle("hidden", !value.trim());
    socialSearchTimer = setTimeout(() => searchSocialUsers(value), 320);
  });
  $("social-role-filter")?.addEventListener("change", () => searchSocialUsers($("social-user-search")?.value || ""));
  $("btn-clear-social-search")?.addEventListener("click", () => {
    $("social-user-search").value = "";
    $("social-search-results").innerHTML = "";
    $("social-search-status").textContent = "Nhập ít nhất 2 ký tự để bắt đầu tìm kiếm.";
    $("btn-clear-social-search").classList.add("hidden");
    $("social-user-search").focus();
  });
  $("social-friend-filter")?.addEventListener("input", renderSocialFriends);
  $("btn-refresh-social")?.addEventListener("click", async () => {
    try {
      await loadSocialProfiles(true);
      renderSocialHub();
      toast("Đã làm mới danh bạ.");
    } catch (error) {
      toast("Không thể làm mới: " + errMsg(error.code, error.message), false);
    }
  });
  document.querySelectorAll("[data-social-tab]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-social-tab]").forEach(item => item.classList.toggle("active", item === button));
      $("social-incoming-list").classList.toggle("hidden", button.dataset.socialTab !== "incoming");
      $("social-outgoing-list").classList.toggle("hidden", button.dataset.socialTab !== "outgoing");
    });
  });
  $("social-message-input")?.addEventListener("input", autoResizeSocialComposer);
  $("social-message-input")?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendSocialMessage();
    }
  });
  $("btn-send-social-message")?.addEventListener("click", sendSocialMessage);
  $("social-chat-back")?.addEventListener("click", closeSocialChat);
  $("btn-social-chat-info")?.addEventListener("click", () => {
    if (!socialSelectedFriend || !currentUser) return;
    const relationshipId = socialPairId(currentUser.uid, socialSelectedFriend.uid);
    if (confirm(`Hủy kết bạn với ${socialSelectedFriend.hoTen}? Bạn sẽ không thể tiếp tục nhắn tin.`)) {
      removeSocialRelationship(relationshipId, `Đã hủy kết bạn với ${socialSelectedFriend.hoTen}.`);
    }
  });
})();


/* ── Nhóm chat lớp theo học phần ───────────────────────────── */
function classEnrollmentId(courseId, uid) {
  return `${courseId}_${uid}`;
}

function classGroupCourseData(courseId, course = {}) {
  return {
    hocPhanId: courseId,
    maHocPhan: course.maHocPhan || course.tenHocPhan || "",
    tenHocPhan: course.tenHocPhan || course.maHocPhan || "Học phần",
    giaoVienId: course.giaoVienId || "",
    giaoVienTen: course.giaoVienTen || "Giáo viên"
  };
}

async function ensureClassGroupForCourse(courseId, course = {}, extraMemberIds = []) {
  if (!currentUser || !courseId) return;
  const data = classGroupCourseData(courseId, course);
  const teacherId = data.giaoVienId || (currentRole === "giaovien" ? currentUser.uid : "");
  const memberIds = [...new Set([teacherId, ...extraMemberIds].filter(Boolean))];
  if (!teacherId || !memberIds.length) return;

  await setDoc(doc(db, "nhom_chat_lop", courseId), {
    ...data,
    giaoVienId: teacherId,
    giaoVienTen: data.giaoVienTen || (teacherId === currentUser.uid ? currentUserName : "Giáo viên"),
    memberIds: arrayUnion(...memberIds),
    createdAt: course.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function migrateEnrollmentToCanonical(enrollmentDoc) {
  if (!currentUser || !enrollmentDoc) return enrollmentDoc;
  const data = enrollmentDoc.data ? enrollmentDoc.data() : enrollmentDoc;
  const oldId = enrollmentDoc.id || data.id;
  const canonicalId = classEnrollmentId(data.hocPhanId, currentUser.uid);
  if (!data.hocPhanId || oldId === canonicalId) return { id: oldId || canonicalId, ...data };

  await setDoc(doc(db, "ghi_danh", canonicalId), {
    hocPhanId: data.hocPhanId,
    maHocPhan: data.maHocPhan || "",
    tenHocPhan: data.tenHocPhan || "",
    uid: currentUser.uid,
    hoTen: data.hoTen || currentUserName,
    createdAt: data.createdAt || serverTimestamp()
  }, { merge: true });
  await deleteDoc(doc(db, "ghi_danh", oldId)).catch(error => {
    console.warn("Không xóa được ghi danh cũ sau khi chuyển đổi:", error);
  });
  return { id: canonicalId, ...data };
}

async function ensureClassGroupsForCurrentUser(force = false) {
  if (!currentUser) return;
  if (classGroupsSyncPromise && !force) return classGroupsSyncPromise;

  classGroupsSyncPromise = (async () => {
    if (currentRole === "giaovien") {
      const courseSnap = await getDocs(query(
        collection(db, "hoc_phan"),
        where("giaoVienId", "==", currentUser.uid)
      ));
      await Promise.all(courseSnap.docs.map(async courseDoc => {
        const course = courseDoc.data();
        const enrollmentSnap = await getDocs(query(
          collection(db, "ghi_danh"),
          where("hocPhanId", "==", courseDoc.id)
        ));
        const members = [currentUser.uid, ...enrollmentSnap.docs.map(item => item.data().uid).filter(Boolean)];
        await ensureClassGroupForCourse(courseDoc.id, course, members);
      }));
      return;
    }

    const enrollmentSnap = await getDocs(query(
      collection(db, "ghi_danh"),
      where("uid", "==", currentUser.uid)
    ));
    await Promise.all(enrollmentSnap.docs.map(async enrollmentDoc => {
      const enrollment = await migrateEnrollmentToCanonical(enrollmentDoc);
      const courseSnap = await getDoc(doc(db, "hoc_phan", enrollment.hocPhanId));
      if (!courseSnap.exists()) return;
      await ensureClassGroupForCourse(courseSnap.id, courseSnap.data(), [currentUser.uid]);
    }));
  })().finally(() => {
    classGroupsSyncPromise = null;
  });

  return classGroupsSyncPromise;
}

function startClassGroupOverviewListener() {
  if (!currentUser) return;
  classGroupUnsubscribe?.();
  const groupsQuery = query(
    collection(db, "nhom_chat_lop"),
    where("memberIds", "array-contains", currentUser.uid)
  );
  classGroupUnsubscribe = onSnapshot(groupsQuery, snapshot => {
    classGroups = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt));

    classGroupUnreadCount = classGroups.filter(group => {
      if (!group.lastMessage || group.lastSenderId === currentUser.uid) return false;
      return timestampMs(group.updatedAt) > timestampMs(group.readAt?.[currentUser.uid]);
    }).length;

    updateSocialBadges();
    renderClassGroupList();
    if (selectedClassGroup) {
      const fresh = classGroups.find(group => group.id === selectedClassGroup.id);
      if (fresh) selectedClassGroup = fresh;
      else closeClassGroupChat();
    }
    renderPremiumNotifications();
  }, error => {
    console.error("Class group listener error:", error);
    const list = $("class-group-list");
    if (list) list.innerHTML = `<div class="social-empty-state error"><span>🔐</span><strong>Không tải được nhóm lớp</strong><small>${escapeHtml(errMsg(error.code, error.message))}</small></div>`;
  });
}

function setSocialMode(mode) {
  activeSocialMode = mode === "class" ? "class" : "private";
  $("social-private-workspace")?.classList.toggle("hidden", activeSocialMode !== "private");
  $("class-chat-workspace")?.classList.toggle("hidden", activeSocialMode !== "class");
  document.querySelectorAll("[data-social-mode]").forEach(button => {
    button.classList.toggle("active", button.dataset.socialMode === activeSocialMode);
  });
  if (activeSocialMode === "class") {
    ensureClassGroupsForCurrentUser().catch(error => console.error("Class group sync error:", error));
    renderClassGroupList();
  }
}

function renderClassGroupList() {
  const list = $("class-group-list");
  if (!list || !currentUser) return;
  const search = normalizeCourseName($("class-group-search")?.value || "");
  const visible = classGroups.filter(group => {
    const haystack = normalizeCourseName(`${group.tenHocPhan || ""} ${group.maHocPhan || ""} ${group.giaoVienTen || ""}`);
    return !search || haystack.includes(search);
  });
  if ($("class-group-count")) $("class-group-count").textContent = String(classGroups.length);

  if (!visible.length) {
    list.innerHTML = `<div class="social-empty-state compact"><span>🏫</span><strong>${search ? "Không tìm thấy nhóm phù hợp" : "Chưa có nhóm lớp"}</strong><small>${search ? "Thử từ khóa khác." : "Nhóm sẽ được tạo tự động khi bạn tạo hoặc ghi danh học phần."}</small></div>`;
    return;
  }

  list.innerHTML = visible.map(group => {
    const active = selectedClassGroup?.id === group.id;
    const unread = group.lastMessage && group.lastSenderId !== currentUser.uid && timestampMs(group.updatedAt) > timestampMs(group.readAt?.[currentUser.uid]);
    const teacherName = group.giaoVienTen || "Giáo viên";
    return `<button type="button" class="class-group-row ${active ? "active" : ""}" data-class-group-id="${escapeHtml(group.id)}">
      <div class="class-group-avatar">${escapeHtml(socialInitials(group.tenHocPhan || group.maHocPhan || "HP"))}</div>
      <div class="class-group-copy">
        <div><strong>${escapeHtml(group.tenHocPhan || group.maHocPhan || "Học phần")}</strong>${unread ? '<i class="social-unread-dot"></i>' : ""}</div>
        <span class="class-group-teacher-line"><b class="teacher-red-badge">GV</b>${escapeHtml(teacherName)}</span>
        <small>${escapeHtml(group.lastMessage || `${group.memberIds?.length || 1} thành viên · Chưa có tin nhắn`)}</small>
      </div>
      <time>${escapeHtml(socialMessageTime(group.updatedAt || group.createdAt))}</time>
    </button>`;
  }).join("");

  list.querySelectorAll("[data-class-group-id]").forEach(button => {
    button.onclick = () => openClassGroupChat(button.dataset.classGroupId);
  });
}

async function openClassGroupChat(groupId) {
  if (!currentUser || !groupId) return;
  let group = classGroups.find(item => item.id === groupId);
  if (!group) {
    const snap = await getDoc(doc(db, "nhom_chat_lop", groupId));
    if (!snap.exists()) return toast("Nhóm chat lớp chưa sẵn sàng.", false);
    group = { id: snap.id, ...snap.data() };
  }
  if (!group.memberIds?.includes(currentUser.uid)) return toast("Bạn không còn là thành viên của nhóm lớp này.", false);

  selectedClassGroup = group;
  setSocialMode("class");
  $("class-chat-empty")?.classList.add("hidden");
  $("class-chat-active")?.classList.remove("hidden");
  $("class-chat-avatar").textContent = socialInitials(group.tenHocPhan || group.maHocPhan || "HP");
  $("class-chat-name").textContent = group.tenHocPhan || group.maHocPhan || "Nhóm lớp";
  $("class-chat-meta").textContent = `${group.memberIds?.length || 1} thành viên`;
  $("class-chat-teacher").textContent = group.giaoVienTen || "Giáo viên";
  $("class-message-input").value = "";
  autoResizeClassComposer();
  renderClassGroupList();
  startClassGroupMessageListener(group.id);
  await markClassGroupRead(group.id);
  if (window.innerWidth <= 920) $("page-ban-be")?.classList.add("class-chat-mobile-open");
}

function closeClassGroupChat() {
  classGroupMessagesUnsubscribe?.();
  classGroupMessagesUnsubscribe = null;
  selectedClassGroup = null;
  $("class-chat-active")?.classList.add("hidden");
  $("class-chat-empty")?.classList.remove("hidden");
  $("page-ban-be")?.classList.remove("class-chat-mobile-open");
  renderClassGroupList();
}

function startClassGroupMessageListener(groupId) {
  classGroupMessagesUnsubscribe?.();
  const messagesQuery = query(
    collection(db, "nhom_chat_lop", groupId, "tin_nhan"),
    orderBy("createdAt", "desc"),
    limit(300)
  );
  classGroupMessagesUnsubscribe = onSnapshot(messagesQuery, snapshot => {
    const messages = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).reverse();
    renderClassGroupMessages(messages);
    markClassGroupRead(groupId);
  }, error => {
    console.error("Class message listener error:", error);
    $("class-message-list").innerHTML = `<div class="social-empty-state error"><span>!</span><strong>Không tải được tin nhắn lớp</strong><small>${escapeHtml(errMsg(error.code, error.message))}</small></div>`;
  });
}

function renderClassGroupMessages(messages) {
  const list = $("class-message-list");
  if (!list || !currentUser || !selectedClassGroup) return;
  if (!messages.length) {
    list.innerHTML = `<div class="social-conversation-start"><span>🏫</span><strong>Nhóm lớp đã sẵn sàng</strong><p>Giáo viên và học sinh trong học phần có thể trao đổi tại đây.</p></div>`;
    return;
  }

  let lastDate = "";
  list.innerHTML = messages.map(message => {
    const mine = message.senderId === currentUser.uid;
    const isTeacher = message.senderId === selectedClassGroup.giaoVienId || message.senderRole === "giaovien";
    const senderName = message.senderName || (isTeacher ? selectedClassGroup.giaoVienTen : "Thành viên");
    const date = valueToDate(message.createdAt) || valueToDate(message.sentAtClient);
    const dateKey = date ? date.toDateString() : "";
    let separator = "";
    if (dateKey && dateKey !== lastDate) {
      lastDate = dateKey;
      separator = `<div class="social-message-date">${escapeHtml(date.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" }))}</div>`;
    }
    return `${separator}<div class="class-message-row ${mine ? "mine" : "theirs"} ${isTeacher ? "teacher-message" : ""}">
      ${mine ? "" : `<div class="social-avatar tiny ${isTeacher ? "teacher-red-avatar" : "student"}">${escapeHtml(socialInitials(senderName))}</div>`}
      <div class="class-message-stack">
        <div class="class-message-sender"><strong>${escapeHtml(mine ? "Bạn" : senderName)}</strong>${isTeacher ? '<span class="teacher-red-badge">GIÁO VIÊN</span>' : ""}</div>
        <div class="social-message-bubble"><p>${escapeHtml(message.text)}</p><time>${escapeHtml(socialMessageTime(message.createdAt, message.sentAtClient))}</time></div>
      </div>
    </div>`;
  }).join("");
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

async function markClassGroupRead(groupId) {
  if (!currentUser || !groupId) return;
  try {
    await updateDoc(doc(db, "nhom_chat_lop", groupId), {
      [`readAt.${currentUser.uid}`]: serverTimestamp()
    });
  } catch (error) {
    console.warn("Không đánh dấu được nhóm lớp đã đọc:", error);
  }
}

async function sendClassGroupMessage() {
  const input = $("class-message-input");
  if (!currentUser || !selectedClassGroup || !input) return;
  const text = input.value.trim();
  if (!text) return;
  if (text.length > 2000) return toast("Tin nhắn tối đa 2000 ký tự.", false);
  if (!selectedClassGroup.memberIds?.includes(currentUser.uid)) return toast("Bạn không còn trong nhóm lớp này.", false);

  const button = $("btn-send-class-message");
  const originalText = text;
  button.disabled = true;
  input.value = "";
  autoResizeClassComposer();
  try {
    await addDoc(collection(db, "nhom_chat_lop", selectedClassGroup.id, "tin_nhan"), {
      senderId: currentUser.uid,
      senderName: currentUserName,
      senderRole: currentRole,
      text: originalText,
      sentAtClient: new Date().toISOString(),
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "nhom_chat_lop", selectedClassGroup.id), {
      lastMessage: originalText.slice(0, 160),
      lastSenderId: currentUser.uid,
      lastSenderName: currentUserName,
      lastSenderRole: currentRole,
      updatedAt: serverTimestamp(),
      [`readAt.${currentUser.uid}`]: serverTimestamp()
    });
  } catch (error) {
    input.value = originalText;
    autoResizeClassComposer();
    toast("Không gửi được tin nhắn lớp: " + errMsg(error.code, error.message), false);
  } finally {
    button.disabled = false;
    input.focus();
  }
}

function autoResizeClassComposer() {
  const input = $("class-message-input");
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  if ($("class-message-counter")) $("class-message-counter").textContent = `${input.value.length}/2000`;
}

window._openClassChat = async courseId => {
  if (!courseId) return;
  setPage("page-ban-be");
  await loadSocialHub();
  setSocialMode("class");
  await ensureClassGroupsForCurrentUser(true).catch(() => {});
  setTimeout(() => openClassGroupChat(courseId), 100);
};

(function initClassGroupUI() {
  document.querySelectorAll("[data-social-mode]").forEach(button => {
    button.addEventListener("click", () => setSocialMode(button.dataset.socialMode));
  });
  $("class-group-search")?.addEventListener("input", renderClassGroupList);
  $("btn-refresh-class-groups")?.addEventListener("click", async () => {
    try {
      await ensureClassGroupsForCurrentUser(true);
      toast("Đã đồng bộ nhóm lớp.");
    } catch (error) {
      toast("Không thể đồng bộ nhóm lớp: " + errMsg(error.code, error.message), false);
    }
  });
  $("class-message-input")?.addEventListener("input", autoResizeClassComposer);
  $("class-message-input")?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendClassGroupMessage();
    }
  });
  $("btn-send-class-message")?.addEventListener("click", sendClassGroupMessage);
  $("class-chat-back")?.addEventListener("click", closeClassGroupChat);
})();

/* ── Trải nghiệm giao diện Premium ─────────────────────────── */
const PREMIUM_PAGE_META = {
  "page-hoc-phan": {
    icon: "⌂", eyebrow: "QUẢN TRỊ HỌC TẬP", title: "Học phần của bạn",
    description: "Tạo không gian lớp học, quản lý học sinh và bắt đầu mọi hoạt động từ một nơi.",
    action: "Tạo học phần", target: "hp-ten", mode: "focus"
  },
  "page-dang-de": {
    icon: "⇧", eyebrow: "PHÂN PHỐI NỘI DUNG", title: "Đăng đề thi mới",
    description: "Tải đề lên, chọn học phần và thiết lập hạn nộp trong vài bước rõ ràng.",
    action: "Chọn file đề", target: "drop-de", mode: "click"
  },
  "page-ds-de": {
    icon: "▤", eyebrow: "THƯ VIỆN ĐỀ THI", title: "Danh sách đề đã đăng",
    description: "Theo dõi trạng thái, thời hạn và quản lý toàn bộ đề thi theo học phần.",
    action: "Làm mới dữ liệu", target: "btn-refresh-de", mode: "click"
  },
  "page-bai-nop": {
    icon: "↓", eyebrow: "TRUNG TÂM CHẤM BÀI", title: "Bài nộp của học sinh",
    description: "Kiểm tra trạng thái nộp, tải bài làm và phản hồi nhanh cho từng học sinh.",
    action: "Lọc bài nộp", target: "bn-hocphan-filter", mode: "focus"
  },
  "page-ghi-danh": {
    icon: "◇", eyebrow: "BẮT ĐẦU HỌC TẬP", title: "Ghi danh học phần",
    description: "Tham gia lớp học bằng tên học phần và mật khẩu giáo viên đã cung cấp.",
    action: "Nhập mã học phần", target: "gd-mahp", mode: "focus"
  },
  "page-tai-de": {
    icon: "⇩", eyebrow: "TÀI NGUYÊN HỌC TẬP", title: "Đề thi của bạn",
    description: "Tải đề mới nhất, kiểm tra thời hạn và chuẩn bị bài làm đúng tiến độ."
  },
  "page-nop-bai": {
    icon: "↗", eyebrow: "NỘP BÀI AN TOÀN", title: "Gửi bài làm",
    description: "Chọn đúng đề thi, kiểm tra file và nộp bài với trạng thái được đồng bộ tức thì.",
    action: "Chọn file bài", target: "drop-bai", mode: "click"
  },
  "page-ket-qua": {
    icon: "◒", eyebrow: "TIẾN ĐỘ CÁ NHÂN", title: "Kết quả học tập",
    description: "Theo dõi điểm số, nhận xét của giáo viên và lịch sử bài nộp tại một nơi."
  },
  "page-trac-nghiem-gv": {
    icon: "◆", eyebrow: "ĐÁNH GIÁ THÔNG MINH", title: "Trắc nghiệm trực tuyến",
    description: "Thiết kế đề, tự động chấm điểm và theo dõi nhật ký chống gian lận.",
    action: "Thêm câu hỏi", target: "btn-them-cauhoi", mode: "click"
  },
  "page-trac-nghiem-hs": {
    icon: "◆", eyebrow: "BÀI KIỂM TRA CỦA BẠN", title: "Trắc nghiệm trực tuyến",
    description: "Xem đề đang mở, số lượt còn lại và bắt đầu bài làm khi đã sẵn sàng."
  },
  "page-lop-truc-tuyen": {
    icon: "◎", eyebrow: "KẾT NỐI TRỰC TIẾP", title: "Lớp học trực tuyến",
    description: "Lên lịch, tham gia và theo dõi buổi học trực tuyến ngay trong hệ thống.",
    action: "Tạo lịch học", target: "meeting-title", mode: "focus", teacherOnly: true
  },
  "page-ban-be": {
    icon: "✦", eyebrow: "CỘNG ĐỒNG KHOA ĐIỆN TỬ & KTMT", title: "Bạn bè & Tin nhắn",
    description: "Tìm người dùng, xây dựng danh bạ và trò chuyện riêng tư theo thời gian thực.",
    action: "Tìm bạn mới", target: "social-user-search", mode: "focus"
  },
  "page-admin": {
    icon: "▣", eyebrow: "SYSTEM CONTROL", title: "Quản trị hệ thống",
    description: "Quản lý hồ sơ người dùng, phân quyền và giao diện chung của hệ thống."
  },
  "page-phong-hop": {
    icon: "●", eyebrow: "ĐANG TRỰC TUYẾN", title: "Phòng học trực tuyến",
    description: "Bạn đang ở trong một phiên học trực tiếp được bảo vệ và đồng bộ."
  }
};

function premiumRoleLabel() {
  return currentRole === "admin" ? "Không gian quản trị viên" : currentRole === "giaovien" ? "Không gian giáo viên" : "Không gian học sinh";
}

function ensurePremiumPageHero(pageId) {
  const page = $(pageId);
  const baseMeta = PREMIUM_PAGE_META[pageId];
  if (!page || !baseMeta) return;

  const custom = window.ExamFlowBannerConfigs?.[pageId] || {};
  let hero = page.querySelector(":scope > .premium-page-hero");
  if (custom.enabled === false) {
    hero?.remove();
    return;
  }

  const meta = {
    ...baseMeta,
    icon: custom.icon || baseMeta.icon,
    eyebrow: custom.eyebrow || baseMeta.eyebrow,
    title: custom.title || baseMeta.title,
    description: custom.description || baseMeta.description
  };

  if (!hero) {
    hero = document.createElement("section");
    hero.className = "premium-page-hero";
    page.prepend(hero);
  }

  const imageUrl = String(custom.imageUrl || "")
    .split('"').join("")
    .split("\\").join("")
    .replaceAll("\r", "")
    .replaceAll("\n", "");
  const position = custom.position === "left" ? "left center" : custom.position === "right" ? "right center" : "center center";
  const overlay = Math.max(0, Math.min(.8, Number(custom.overlay ?? .48)));
  hero.classList.toggle("has-custom-banner", Boolean(imageUrl));
  if (imageUrl) hero.style.setProperty("--premium-banner-image", `url("${imageUrl}")`);
  else hero.style.removeProperty("--premium-banner-image");
  hero.style.setProperty("--premium-banner-position", position);
  hero.style.setProperty("--premium-banner-overlay", String(overlay));
  hero.dataset.systemBannerId = pageId;

  const canShowAction = meta.action && !(meta.teacherOnly && currentRole !== "giaovien");
  hero.innerHTML = `
    <div class="premium-hero-orb premium-hero-orb-one"></div>
    <div class="premium-hero-orb premium-hero-orb-two"></div>
    <div class="premium-hero-content">
      <div class="premium-hero-icon" aria-hidden="true">${meta.icon}</div>
      <div class="premium-hero-copy">
        <div class="premium-hero-eyebrow"><span></span>${escapeHtml(meta.eyebrow)}</div>
        <h1>${escapeHtml(meta.title)}</h1>
        <p>${escapeHtml(meta.description)}</p>
      </div>
    </div>
    <div class="premium-hero-side">
      <div class="premium-hero-insights">
        <div><small>Không gian</small><strong>${escapeHtml(premiumRoleLabel())}</strong></div>
        <div><small>Dữ liệu hiển thị</small><strong data-premium-count>Đang cập nhật</strong></div>
      </div>
      ${canShowAction ? `<button type="button" class="premium-hero-action" data-premium-target="${meta.target}" data-premium-mode="${meta.mode || "focus"}"><span>${escapeHtml(meta.action)}</span><b>→</b></button>` : ""}
    </div>`;

  const firstHeader = [...page.children].find(el => el.classList?.contains("page-header"));
  if (firstHeader) {
    firstHeader.classList.add("legacy-page-toolbar");
    const actions = firstHeader.querySelector(".header-actions");
    if (!actions || !actions.children.length) firstHeader.classList.add("toolbar-title-only");
  }

  hero.querySelector(".premium-hero-action")?.addEventListener("click", event => {
    const button = event.currentTarget;
    const target = $(button.dataset.premiumTarget);
    if (!target) return;
    if (button.dataset.premiumMode === "click") target.click();
    else {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => target.focus?.(), 250);
    }
  });

  setupPremiumCardSpotlights(page);
}

function countVisibleRows(page) {
  const rows = [...page.querySelectorAll("tbody tr")].filter(row =>
    !row.classList.contains("empty-row") && row.offsetParent !== null
  );
  if (rows.length) return `${rows.length} mục`;

  const cards = [...page.querySelectorAll(".meeting-card, .quiz-card, .tn-card, .social-friend-row, .social-person-card")].filter(card => card.offsetParent !== null);
  if (cards.length) return `${cards.length} mục`;
  return "Sẵn sàng";
}

function updatePremiumPageMetrics(pageId) {
  const page = $(pageId);
  const count = page?.querySelector("[data-premium-count]");
  if (!page || !count) return;
  requestAnimationFrame(() => { count.textContent = countVisibleRows(page); });
}

function setupPremiumCardSpotlights(root = document) {
  root.querySelectorAll(".card:not([data-spotlight-ready]), .meeting-card:not([data-spotlight-ready]), .tn-question-card:not([data-spotlight-ready])").forEach(card => {
    card.dataset.spotlightReady = "1";
    card.addEventListener("pointermove", event => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mouse-x", `${event.clientX - rect.left}px`);
      card.style.setProperty("--mouse-y", `${event.clientY - rect.top}px`);
    });
  });
}

const COMMAND_ACTIONS = [
  { id: "theme", icon: "◐", title: "Đổi giao diện sáng / tối", subtitle: "Tùy chỉnh màu giao diện", keywords: "theme dark light giao dien", run: toggleTheme },
  { id: "sidebar", icon: "⇤", title: "Thu gọn / mở rộng thanh menu", subtitle: "Tối ưu không gian làm việc", keywords: "sidebar menu thu gon", run: () => $("btn-sidebar-toggle")?.click() },
  { id: "refresh", icon: "↻", title: "Tải lại trang hiện tại", subtitle: "Làm mới dữ liệu đang hiển thị", keywords: "refresh reload lam moi", run: () => document.querySelector(".nav-item.active")?.click() }
];

let commandItems = [];
let commandActiveIndex = 0;

function availablePageCommands() {
  return [...document.querySelectorAll("#sidebar-nav .nav-item")].map(item => {
    const pageId = item.dataset.page;
    const meta = PREMIUM_PAGE_META[pageId] || {};
    return {
      id: pageId,
      icon: item.querySelector(".nav-icon")?.textContent?.trim() || meta.icon || "→",
      title: PAGE_META[pageId]?.[0] || item.textContent.trim(),
      subtitle: PAGE_META[pageId]?.[1] || meta.description || "Mở trang",
      keywords: `${item.textContent} ${meta.eyebrow || ""}`,
      run: () => item.click()
    };
  });
}

function renderCommandResults(queryText = "") {
  const queryValue = normalizeCourseName(queryText);
  commandItems = [...availablePageCommands(), ...COMMAND_ACTIONS].filter(item => {
    if (!queryValue) return true;
    return normalizeCourseName(`${item.title} ${item.subtitle} ${item.keywords || ""}`).includes(queryValue);
  });
  commandActiveIndex = Math.min(commandActiveIndex, Math.max(0, commandItems.length - 1));

  const results = $("command-results");
  if (!results) return;
  if (!commandItems.length) {
    results.innerHTML = `<div class="command-empty"><span>⌕</span><strong>Không tìm thấy chức năng</strong><small>Thử từ khóa khác hoặc kiểm tra chính tả.</small></div>`;
    return;
  }

  results.innerHTML = commandItems.map((item, index) => `
    <button type="button" class="command-result ${index === commandActiveIndex ? "active" : ""}" data-command-index="${index}">
      <span class="command-result-icon">${escapeHtml(item.icon)}</span>
      <span class="command-result-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subtitle)}</small></span>
      <kbd>↵</kbd>
    </button>`).join("");

  results.querySelectorAll(".command-result").forEach(button => {
    button.addEventListener("mouseenter", () => {
      commandActiveIndex = Number(button.dataset.commandIndex);
      updateCommandActiveState();
    });
    button.addEventListener("click", () => executeCommand(Number(button.dataset.commandIndex)));
  });
}

function updateCommandActiveState() {
  $("command-results")?.querySelectorAll(".command-result").forEach((button, index) => {
    button.classList.toggle("active", index === commandActiveIndex);
    if (index === commandActiveIndex) button.scrollIntoView({ block: "nearest" });
  });
}

function executeCommand(index = commandActiveIndex) {
  const item = commandItems[index];
  if (!item) return;
  closeCommandCenter();
  item.run();
}

function openCommandCenter() {
  const center = $("command-center");
  if (!center || !currentUser) return;
  center.classList.remove("hidden");
  document.body.classList.add("command-open");
  commandActiveIndex = 0;
  $("command-search").value = "";
  renderCommandResults();
  requestAnimationFrame(() => $("command-search")?.focus());
}

function closeCommandCenter() {
  $("command-center")?.classList.add("hidden");
  document.body.classList.remove("command-open");
}

function updateNetworkState() {
  const online = navigator.onLine;
  const pill = $("network-pill");
  if (pill) {
    pill.classList.toggle("online", online);
    pill.classList.toggle("offline", !online);
    const label = pill.querySelector("strong");
    if (label) label.textContent = online ? "Online" : "Offline";
  }
  $("offline-banner")?.classList.toggle("hidden", online);
  if ($("cloud-status-text")) $("cloud-status-text").textContent = online ? "Đang kết nối ổn định" : "Đang chờ kết nối Internet";
  renderPremiumNotifications();
}

function renderPremiumNotifications() {
  const list = $("notification-list");
  if (!list) return;
  const online = navigator.onLine;
  const role = currentRole === "admin" ? "Quản trị viên" : currentRole === "giaovien" ? "Giáo viên" : currentRole === "hocsinh" ? "Học sinh" : "Người dùng";
  const items = [
    { icon: online ? "✓" : "!", tone: online ? "success" : "danger", title: online ? "Kết nối Internet ổn định" : "Đã mất kết nối Internet", text: online ? "Dữ liệu có thể đồng bộ với Firebase theo thời gian thực." : "Ứng dụng sẽ hoạt động hạn chế cho đến khi mạng được khôi phục.", time: "Hiện tại" },
    { icon: "⌕", tone: "brand", title: "Tìm chức năng trong một giây", text: "Nhấn Ctrl + K để mở Trung tâm lệnh từ bất kỳ màn hình nào.", time: "Mẹo sử dụng" },
    { icon: "◈", tone: "neutral", title: `Không gian ${role}`, text: currentRole === "admin" ? "Bạn có quyền quản lý người dùng và giao diện toàn hệ thống." : currentRole === "giaovien" ? "Bạn có quyền tạo học phần, đề thi, trắc nghiệm và lớp học." : "Bạn có thể ghi danh, tải đề, nộp bài và theo dõi kết quả.", time: "Quyền tài khoản" }
  ];
  if (classGroupUnreadCount > 0) items.unshift({ icon: "🏫", tone: "danger", title: `${classGroupUnreadCount} nhóm lớp có tin mới`, text: "Mở Tin nhắn & Nhóm lớp để xem trao đổi mới.", time: "Nhóm lớp" });
  if (socialUnreadCount > 0) items.unshift({ icon: "💬", tone: "brand", title: `${socialUnreadCount} cuộc trò chuyện chưa đọc`, text: "Mở Tin nhắn & Nhóm lớp để xem nội dung mới.", time: "Tin nhắn" });
  if (socialPendingCount > 0) items.unshift({ icon: "✦", tone: "success", title: `${socialPendingCount} lời mời kết bạn mới`, text: "Có người đang chờ bạn chấp nhận lời mời.", time: "Bạn bè" });
  list.innerHTML = items.map(item => `
    <article class="notification-item">
      <span class="notification-icon ${item.tone}">${item.icon}</span>
      <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p><small>${escapeHtml(item.time)}</small></div>
    </article>`).join("");
  if ($("notification-badge")) $("notification-badge").textContent = String(items.length);
}

function openNotifications() {
  $("notification-drawer")?.classList.add("open");
  $("notification-backdrop")?.classList.add("open");
  $("notification-drawer")?.setAttribute("aria-hidden", "false");
  renderPremiumNotifications();
}

function closeNotifications() {
  $("notification-drawer")?.classList.remove("open");
  $("notification-backdrop")?.classList.remove("open");
  $("notification-drawer")?.setAttribute("aria-hidden", "true");
}

function toggleProfilePopover(force) {
  const popover = $("profile-popover");
  if (!popover) return;
  const shouldOpen = typeof force === "boolean" ? force : popover.classList.contains("hidden");
  popover.classList.toggle("hidden", !shouldOpen);
  $("topbar-profile")?.classList.toggle("active", shouldOpen);
}

(function initPremiumExperience() {
  $("btn-command-center")?.addEventListener("click", openCommandCenter);
  $("command-center")?.addEventListener("mousedown", event => {
    if (event.target === $("command-center")) closeCommandCenter();
  });
  $("command-search")?.addEventListener("input", event => {
    commandActiveIndex = 0;
    renderCommandResults(event.target.value);
  });
  $("command-search")?.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      commandActiveIndex = Math.min(commandItems.length - 1, commandActiveIndex + 1);
      updateCommandActiveState();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      commandActiveIndex = Math.max(0, commandActiveIndex - 1);
      updateCommandActiveState();
    } else if (event.key === "Enter") {
      event.preventDefault();
      executeCommand();
    }
  });

  $("btn-notifications")?.addEventListener("click", openNotifications);
  $("btn-close-notifications")?.addEventListener("click", closeNotifications);
  $("notification-backdrop")?.addEventListener("click", closeNotifications);

  $("topbar-profile")?.addEventListener("click", event => {
    event.stopPropagation();
    toggleProfilePopover();
  });
  $("profile-popover")?.addEventListener("click", event => event.stopPropagation());
  $("profile-theme-action")?.addEventListener("click", () => { toggleTheme(); toggleProfilePopover(false); });
  $("profile-command-action")?.addEventListener("click", () => { toggleProfilePopover(false); openCommandCenter(); });
  $("profile-social-action")?.addEventListener("click", () => {
    toggleProfilePopover(false);
    const navItem = document.querySelector('.nav-item[data-page="page-ban-be"]');
    if (navItem) navItem.click();
    else { setPage("page-ban-be"); loadSocialHub(); }
  });
  $("profile-logout-action")?.addEventListener("click", () => signOut(auth));
  document.addEventListener("click", () => toggleProfilePopover(false));

  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if ($("command-center")?.classList.contains("hidden")) openCommandCenter();
      else closeCommandCenter();
    }
    if (event.key === "Escape") {
      closeCommandCenter();
      closeNotifications();
      toggleProfilePopover(false);
    }
  });

  window.addEventListener("online", updateNetworkState);
  window.addEventListener("offline", updateNetworkState);
  updateNetworkState();
  renderPremiumNotifications();

  const pageStage = document.querySelector(".page-stage");
  if (pageStage) {
    let observerFrame = 0;
    const observer = new MutationObserver(() => {
      if (observerFrame) return;
      observerFrame = requestAnimationFrame(() => {
        observerFrame = 0;
        const activePage = document.querySelector(".page.active");
        if (activePage?.id) updatePremiumPageMetrics(activePage.id);
        setupPremiumCardSpotlights(activePage || pageStage);
      });
    });
    observer.observe(pageStage, { childList: true, subtree: true });
  }

  document.addEventListener("pointerdown", event => {
    const button = event.target.closest(".btn-primary, .btn-outline, .btn-sm, .nav-item");
    if (!button) return;
    button.classList.remove("premium-pressed");
    requestAnimationFrame(() => button.classList.add("premium-pressed"));
    setTimeout(() => button.classList.remove("premium-pressed"), 340);
  });
})();

function errMsg(code, fallback = "") {
  return ({
    "auth/email-already-in-use":   "Email này đã được đăng ký.",
    "auth/invalid-email":          "Email không hợp lệ.",
    "auth/user-not-found":         "Không tìm thấy tài khoản.",
    "auth/wrong-password":         "Sai mật khẩu.",
    "auth/invalid-credential":     "Email hoặc mật khẩu không đúng.",
    "auth/weak-password":          "Mật khẩu quá yếu (tối thiểu 6 ký tự).",
    "auth/too-many-requests":      "Thử lại quá nhiều lần. Vui lòng đợi.",
    "auth/network-request-failed": "Lỗi mạng. Kiểm tra kết nối Internet.",
    "auth/network-timeout":        "Không kết nối được Firebase sau 20 giây.",
    "permission-denied":           "Firestore đang từ chối quyền truy cập.",
    "firestore/permission-denied": "Firestore đang từ chối quyền truy cập."
  })[code] || fallback || (code ? "Lỗi: " + code : "Đã xảy ra lỗi không xác định.");
}


/* ══════════════════════════════════════════════════════════════
   EXAMFLOW QUIZ BATTLE ARENA — EPIC MINI GAME LAYER
   Giữ nguyên cơ chế chấm điểm, giới hạn lượt làm và chống gian lận.
   ══════════════════════════════════════════════════════════════ */
const quizArenaState = {
  currentIndex: 0,
  answered: new Set(),
  combo: 0,
  maxCombo: 0,
  xp: 0,
  lastAnswerAt: 0,
  sound: localStorage.getItem("examflow-game-sound") !== "0",
  startedAtMs: 0,
  logStartMs: 0,
  finalizing: false
};

function quizArenaBossTitle(quiz) {
  const titles = ["Hộ Vệ Tri Thức", "Sentinel Tối Thượng", "Lõi Hắc Ám", "Kẻ Canh Giữ Đáp Án", "Titan Học Thuật"];
  const seed = [...String(quiz?.tieuDe || "Boss")].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return titles[seed % titles.length];
}

function quizArenaTimeLabel() {
  const seconds = Math.max(0, Math.floor((Date.now() - quizArenaState.logStartMs) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function quizArenaLog(message, tone = "normal") {
  const log = $("quiz-battle-log");
  if (!log) return;
  const row = document.createElement("p");
  row.className = tone;
  const time = document.createElement("time");
  time.textContent = quizArenaTimeLabel();
  const copy = document.createElement("span");
  copy.textContent = message;
  row.append(time, copy);
  log.append(row);
  while (log.children.length > 7) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}

function quizArenaPlayTone(type = "attack") {
  if (!quizArenaState.sound) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = quizArenaPlayTone._ctx || (quizArenaPlayTone._ctx = new AudioContextClass());
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const frequencies = { attack: [180, 420], navigate: [280, 360], warning: [150, 95], victory: [420, 720] };
    const [from, to] = frequencies[type] || frequencies.attack;
    osc.type = type === "warning" ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), ctx.currentTime + .13);
    gain.gain.setValueAtTime(.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.08, ctx.currentTime + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .16);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + .18);
  } catch { /* Âm thanh chỉ là hiệu ứng phụ. */ }
}

function quizArenaFocusPercent() {
  const limit = Math.max(1, activeQuiz?.gioiHanViPham || 3);
  return Math.max(0, Math.round(100 - (quizTotalViolations / limit) * 100));
}

function updateQuizArenaHud() {
  const total = quizAttemptQuestions.length || 0;
  const answered = quizArenaState.answered.size;
  const progress = total ? Math.round((answered / total) * 100) : 0;
  const barrier = Math.max(0, 100 - progress);
  const focus = quizArenaFocusPercent();

  if ($("quiz-current-number")) $("quiz-current-number").textContent = String(Math.min(total, quizArenaState.currentIndex + 1));
  if ($("quiz-total-number")) $("quiz-total-number").textContent = String(total);
  if ($("quiz-answered-count")) $("quiz-answered-count").textContent = String(answered);
  if ($("quiz-combo")) $("quiz-combo").textContent = `x${quizArenaState.combo}`;
  if ($("quiz-xp")) $("quiz-xp").textContent = String(quizArenaState.xp);
  if ($("quiz-violation-count")) $("quiz-violation-count").textContent = String(quizTotalViolations);
  if ($("quiz-mission-progress")) $("quiz-mission-progress").style.width = `${progress}%`;
  if ($("quiz-boss-shield")) $("quiz-boss-shield").style.width = `${barrier}%`;
  if ($("quiz-boss-shield-label")) $("quiz-boss-shield-label").textContent = `${barrier}%`;
  if ($("quiz-focus-bar")) $("quiz-focus-bar").style.width = `${focus}%`;
  if ($("quiz-focus-label")) $("quiz-focus-label").textContent = `${focus}%`;
  $("quiz-lockdown")?.classList.toggle("arena-focus-danger", focus <= 34);

  renderQuizArenaMap();
}

function renderQuizArenaMap() {
  const map = $("quiz-question-map");
  if (!map) return;
  map.innerHTML = quizAttemptQuestions.map((q, index) => {
    const active = index === quizArenaState.currentIndex;
    const answered = quizArenaState.answered.has(q.id);
    return `<button type="button" class="arena-map-node ${active ? "active" : ""} ${answered ? "answered" : ""}" data-arena-index="${index}" aria-label="Mở câu ${index + 1}">${index + 1}</button>`;
  }).join("");
  map.querySelectorAll("[data-arena-index]").forEach(button => {
    button.addEventListener("click", () => showQuizArenaQuestion(Number(button.dataset.arenaIndex)));
  });
}

function showQuizArenaQuestion(index, playSound = true) {
  if (!quizAttemptQuestions.length) return;
  quizArenaState.currentIndex = Math.max(0, Math.min(quizAttemptQuestions.length - 1, index));
  renderQuizQuestions();
  updateQuizProgress();
  if (playSound) quizArenaPlayTone("navigate");
}

function quizArenaAttack(questionId) {
  const now = Date.now();
  quizArenaState.combo = now - quizArenaState.lastAnswerAt <= 30000 ? quizArenaState.combo + 1 : 1;
  quizArenaState.lastAnswerAt = now;
  quizArenaState.maxCombo = Math.max(quizArenaState.maxCombo, quizArenaState.combo);
  const damage = 100 + Math.min(150, (quizArenaState.combo - 1) * 15);
  const xpGain = 10 + Math.min(20, quizArenaState.combo * 2);
  quizArenaState.xp += xpGain;

  const core = $("quiz-boss-core");
  const stage = $("quiz-arena-stage");
  core?.classList.remove("hit");
  stage?.classList.remove("arena-attack-flash");
  requestAnimationFrame(() => {
    core?.classList.add("hit");
    stage?.classList.add("arena-attack-flash");
  });
  setTimeout(() => { core?.classList.remove("hit"); stage?.classList.remove("arena-attack-flash"); }, 480);

  const float = $("quiz-damage-float");
  if (float) {
    float.textContent = `-${damage}`;
    float.classList.remove("show");
    requestAnimationFrame(() => float.classList.add("show"));
    setTimeout(() => float.classList.remove("show"), 700);
  }

  quizArenaPlayTone("attack");
  quizArenaLog(`Đã khóa câu ${quizAttemptQuestions.findIndex(q => q.id === questionId) + 1}. Combo x${quizArenaState.combo}, nhận ${xpGain} XP.`, "attack");
  updateQuizArenaHud();
}

function renderQuizQuestions() {
  const wrap = $("quiz-questions-list");
  if (!wrap) return;
  const q = quizAttemptQuestions[quizArenaState.currentIndex];
  if (!q) {
    wrap.innerHTML = `<div class="arena-question-empty">Không tìm thấy câu hỏi.</div>`;
    return;
  }

  const chosen = quizAnswers[q.id];
  wrap.innerHTML = `
    <article class="arena-question-card" data-question-id="${escapeHtml(q.id)}">
      <div class="arena-question-head">
        <span class="arena-round-label">ROUND ${String(quizArenaState.currentIndex + 1).padStart(2, "0")}</span>
        <span class="arena-question-state ${chosen !== undefined ? "locked" : ""}">${chosen !== undefined ? "ĐÃ CHỌN ĐÁP ÁN" : "CHỜ LỆNH TẤN CÔNG"}</span>
      </div>
      <h3>${escapeHtml(q.noiDung)}</h3>
      <div class="arena-answer-grid">
        ${q.options.map((opt, optionIndex) => `
          <button type="button" class="arena-answer ${chosen === optionIndex ? "selected" : ""}" data-qid="${escapeHtml(q.id)}" data-opt="${optionIndex}">
            <span class="arena-answer-key">${String.fromCharCode(65 + optionIndex)}</span>
            <span class="arena-answer-copy">${escapeHtml(opt.text)}</span>
            <span class="arena-answer-lock">${chosen === optionIndex ? "◆" : "◇"}</span>
          </button>`).join("")}
      </div>
    </article>`;

  wrap.querySelectorAll(".arena-answer").forEach(button => {
    button.addEventListener("click", () => {
      const qid = button.dataset.qid;
      const optionIndex = Number(button.dataset.opt);
      const firstAnswer = !quizArenaState.answered.has(qid);
      quizAnswers[qid] = optionIndex;
      quizArenaState.answered.add(qid);
      renderQuizQuestions();
      updateQuizProgress();
      if (firstAnswer) {
        quizArenaAttack(qid);
        if (quizArenaState.currentIndex < quizAttemptQuestions.length - 1) {
          setTimeout(() => showQuizArenaQuestion(quizArenaState.currentIndex + 1, false), 520);
        }
      } else {
        quizArenaLog(`Đã thay đổi lựa chọn ở câu ${quizArenaState.currentIndex + 1}.`, "normal");
      }
    });
  });

  if ($("btn-quiz-prev")) $("btn-quiz-prev").disabled = quizArenaState.currentIndex === 0;
  if ($("btn-quiz-next")) $("btn-quiz-next").disabled = quizArenaState.currentIndex >= quizAttemptQuestions.length - 1;
}

function updateQuizProgress() {
  const answered = Object.keys(quizAnswers).length;
  const total = quizAttemptQuestions.length;
  if ($("quiz-progress-note")) $("quiz-progress-note").textContent = `Đã trả lời ${answered}/${total} câu`;
  updateQuizArenaHud();
}

function updateQuizTimerDisplay() {
  const s = Math.max(0, quizRemainingSeconds);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const el = $("quiz-timer");
  if (el) {
    el.textContent = `${mm}:${ss}`;
    el.classList.toggle("danger", s <= 60);
  }
  if (s === 60) {
    quizArenaPlayTone("warning");
    quizArenaLog("Cảnh báo: chỉ còn 60 giây. Hãy chuẩn bị kết liễu Boss!", "warning");
  }
}

function updateViolationBadge() {
  const badge = $("quiz-violation-badge");
  if (!badge) return;
  if (quizTotalViolations > 0) {
    badge.textContent = `⚠ Vi phạm: ${quizTotalViolations}/${activeQuiz?.gioiHanViPham || 3}`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
  updateQuizArenaHud();
}

function logQuizViolation(type, message) {
  if (quizSubmitting) return;
  quizViolationLog.push({ loai: type, luc: new Date().toISOString() });
  quizTotalViolations++;
  quizArenaState.combo = 0;
  updateViolationBadge();
  showQuizWarning(message);
  quizArenaPlayTone("warning");
  quizArenaLog(`Focus Shield bị tấn công: ${violationLabel(type)}.`, "warning");
  $("quiz-lockdown")?.classList.add("arena-damaged");
  setTimeout(() => $("quiz-lockdown")?.classList.remove("arena-damaged"), 420);

  const limit = activeQuiz?.gioiHanViPham || 3;
  if (quizTotalViolations >= limit) submitQuizAttempt("tu_dong_vi_pham");
}

function resetQuizArenaState() {
  quizArenaState.currentIndex = 0;
  quizArenaState.answered = new Set();
  quizArenaState.combo = 0;
  quizArenaState.maxCombo = 0;
  quizArenaState.xp = 0;
  quizArenaState.lastAnswerAt = 0;
  quizArenaState.startedAtMs = Date.now();
  quizArenaState.logStartMs = Date.now();
  quizArenaState.finalizing = false;
  const log = $("quiz-battle-log");
  if (log) log.innerHTML = `<p class="system"><time>00:00</time><span>Battle Arena đã khởi động. Hãy phá vỡ phong ấn của Boss!</span></p>`;
}

async function startQuizAttempt(quiz) {
  activeQuiz = quiz;
  quizAttemptQuestions = buildAttemptQuestions(quiz);
  quizAnswers = {};
  quizViolationLog = [];
  quizTotalViolations = 0;
  quizSubmitting = false;
  quizStartedAt = new Date();
  quizRemainingSeconds = quiz.thoiGianPhut * 60;
  resetQuizArenaState();

  const bossTitle = quizArenaBossTitle(quiz);
  if ($("quiz-lockdown-course")) $("quiz-lockdown-course").textContent = courseLabel({ maHocPhan: quiz.maHocPhan, tenHocPhan: quiz.tenHocPhan });
  if ($("quiz-lockdown-title")) $("quiz-lockdown-title").textContent = quiz.tieuDe;
  if ($("quiz-boss-name")) $("quiz-boss-name").textContent = bossTitle.toUpperCase();
  if ($("quiz-boss-caption")) $("quiz-boss-caption").textContent = bossTitle;
  hide("quiz-warning-banner");
  $("quiz-warning-banner").textContent = "";
  updateViolationBadge();
  renderQuizQuestions();
  updateQuizProgress();
  updateQuizTimerDisplay();

  show("quiz-lockdown");
  hide("quiz-result-overlay");
  document.body.classList.add("quiz-locked", "quiz-arena-active");
  quizArenaLog(`Boss ${bossTitle} đã xuất hiện. ${quizAttemptQuestions.length} phong ấn cần được phá vỡ.`, "boss");

  await requestQuizFullscreen();
  attachAntiCheatListeners();

  quizTimerInterval = setInterval(() => {
    quizRemainingSeconds--;
    updateQuizTimerDisplay();
    if (quizRemainingSeconds <= 0) submitQuizAttempt("het_gio");
  }, 1000);

  window.onbeforeunload = (event) => {
    event.preventDefault();
    event.returnValue = "";
    return "";
  };
}

function quizArenaRank(score, violations) {
  if (score >= 9 && violations === 0) return "S";
  if (score >= 8) return "A";
  if (score >= 6.5) return "B";
  if (score >= 5) return "C";
  return "D";
}

function showQuizArenaResult({ score, correct, total, rank, xp, maxCombo, hiddenScore, reason }) {
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  const damage = hiddenScore ? 100 : accuracy;
  const victory = hiddenScore || score >= 5;
  const autoReason = reason === "tu_dong_vi_pham" ? "Nhiệm vụ kết thúc do vượt giới hạn vi phạm." : reason === "het_gio" ? "Hết thời gian chiến đấu." : "Bạn đã hoàn thành toàn bộ nhiệm vụ.";

  if ($("quiz-result-rank")) $("quiz-result-rank").textContent = hiddenScore ? "✓" : rank;
  if ($("quiz-result-eyebrow")) $("quiz-result-eyebrow").textContent = hiddenScore ? "MISSION COMPLETE" : victory ? "BOSS DEFEATED" : "BATTLE COMPLETE";
  if ($("quiz-result-title")) $("quiz-result-title").textContent = hiddenScore ? "Đã nộp bài!" : victory ? "Chiến thắng!" : "Trận đấu kết thúc";
  if ($("quiz-result-message")) $("quiz-result-message").textContent = hiddenScore ? "Điểm số đang được phong ấn và sẽ hiển thị khi giáo viên công bố." : autoReason;
  if ($("quiz-result-score")) $("quiz-result-score").textContent = hiddenScore ? "ẨN" : `${formatScore(score)}/10`;
  if ($("quiz-result-accuracy")) $("quiz-result-accuracy").textContent = hiddenScore ? "—" : `${accuracy}%`;
  if ($("quiz-result-combo")) $("quiz-result-combo").textContent = `x${maxCombo}`;
  if ($("quiz-result-xp")) $("quiz-result-xp").textContent = `+${xp}`;
  if ($("quiz-result-damage")) $("quiz-result-damage").style.width = `${damage}%`;
  if ($("quiz-result-damage-label")) $("quiz-result-damage-label").textContent = hiddenScore ? "Nhiệm vụ đã được gửi an toàn" : `Sát thương Boss: ${damage}%`;
  $("quiz-result-overlay")?.classList.toggle("result-defeat", !victory);
  show("quiz-result-overlay");
  quizArenaPlayTone("victory");
}

function finishQuizArena() {
  hide("quiz-result-overlay");
  hide("quiz-lockdown");
  document.body.classList.remove("quiz-locked", "quiz-arena-active");
  activeQuiz = null;
  quizAttemptQuestions = [];
  quizAnswers = {};
  quizArenaState.finalizing = false;
  if (currentUser) loadTracNghiem_HS();
}

async function submitQuizAttempt(reason) {
  if (quizSubmitting || quizArenaState.finalizing) return;
  quizSubmitting = true;
  quizArenaState.finalizing = true;
  quizFullscreenExpected = false;

  clearInterval(quizTimerInterval);
  quizTimerInterval = null;
  detachAntiCheatListeners();
  window.onbeforeunload = null;

  try {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  } catch { /* bỏ qua */ }

  const soCauDung = quizAttemptQuestions.filter(q => {
    const chosen = quizAnswers[q.id];
    return chosen !== undefined && q.options[chosen]?.correct;
  }).length;
  const tongSoCau = quizAttemptQuestions.length;
  const diem = tongSoCau ? Math.round((soCauDung / tongSoCau) * 1000) / 100 : 0;
  const rank = quizArenaRank(diem, quizTotalViolations);
  const completionBonus = quizArenaState.answered.size === tongSoCau ? 50 : 0;
  const accuracyBonus = Math.round((diem / 10) * 100);
  const finalXp = quizArenaState.xp + completionBonus + accuracyBonus;
  const quiz = activeQuiz;

  try {
    await addDoc(collection(db, "bai_lam_trac_nghiem"), {
      quizId: quiz.id,
      hocPhanId: quiz.hocPhanId,
      maHocPhan: quiz.maHocPhan || "",
      tenHocPhan: quiz.tenHocPhan || "",
      tieuDe: quiz.tieuDe,
      uid: currentUser.uid,
      hoTen: currentUserName,
      email: currentUser.email || "",
      diem,
      soCauDung,
      tongSoCau,
      trangThaiNop: reason,
      tongSoViPham: quizTotalViolations,
      nhatKyViPham: quizViolationLog,
      hienDiemNgay: quiz.hienDiemNgay !== false,
      batDauAtClient: quizStartedAt.toISOString(),
      nopAtClient: new Date().toISOString(),
      gameMode: "battle_arena_v1",
      battleRank: rank,
      battleXp: finalXp,
      maxCombo: quizArenaState.maxCombo,
      answeredCount: quizArenaState.answered.size,
      battleDurationMs: Math.max(0, Date.now() - quizArenaState.startedAtMs),
      focusShield: quizArenaFocusPercent(),
      createdAt: serverTimestamp()
    });

    showQuizArenaResult({
      score: diem,
      correct: soCauDung,
      total: tongSoCau,
      rank,
      xp: finalXp,
      maxCombo: quizArenaState.maxCombo,
      hiddenScore: quiz.hienDiemNgay === false,
      reason
    });
  } catch (error) {
    quizSubmitting = false;
    quizArenaState.finalizing = false;
    quizFullscreenExpected = true;
    toast("Lỗi khi nộp bài: " + error.message, false);
    quizArenaLog("Không gửi được kết quả. Hệ thống đã khôi phục trận đấu để bạn thử lại.", "warning");
    await requestQuizFullscreen().catch(() => {});
    attachAntiCheatListeners();
    quizTimerInterval = setInterval(() => {
      quizRemainingSeconds--;
      updateQuizTimerDisplay();
      if (quizRemainingSeconds <= 0) submitQuizAttempt("het_gio");
    }, 1000);
  }
}

$("btn-quiz-prev")?.addEventListener("click", () => showQuizArenaQuestion(quizArenaState.currentIndex - 1));
$("btn-quiz-next")?.addEventListener("click", () => showQuizArenaQuestion(quizArenaState.currentIndex + 1));
$("btn-quiz-sound")?.addEventListener("click", () => {
  quizArenaState.sound = !quizArenaState.sound;
  try { localStorage.setItem("examflow-game-sound", quizArenaState.sound ? "1" : "0"); } catch {}
  $("btn-quiz-sound").textContent = quizArenaState.sound ? "🔊" : "🔇";
  $("btn-quiz-sound").title = quizArenaState.sound ? "Tắt âm thanh" : "Bật âm thanh";
  if (quizArenaState.sound) quizArenaPlayTone("navigate");
});
$("btn-close-quiz-result")?.addEventListener("click", finishQuizArena);


/* ── ExamFlow Nexus integration bridge ─────────────────────── */
window.ExamFlowCore = Object.freeze({
  get auth() { return auth; },
  get db() { return db; },
  get storage() { return storage; },
  get currentUser() { return currentUser; },
  get currentRole() { return currentRole; },
  get currentUserName() { return currentUserName; },
  normalizeSystemRole,
  systemRoleLabel,
  get teacherCourses() { return teacherHocPhanList.slice(); },
  get studentCourses() { return studentHocPhanList.slice(); },
  setPage,
  toast,
  show,
  hide,
  applyTheme,
  toggleTheme,
  normalizeCourseName,
  valueToDate,
  fmtDate,
  fmtOptionalDate,
  formatScore,
  courseLabel,
  escapeHtml,
  refreshTopbarDate
});
window.dispatchEvent(new CustomEvent("examflow:core-ready"));


/* ══════════════════════════════════════════════════════════════
   EXAMFLOW ADMIN CONTROL CENTER
   Quản trị người dùng, học phần, file, bài nộp, điểm và giao diện.
   ══════════════════════════════════════════════════════════════ */
(() => {
  if (window.ExamFlowAdmin) return;

  const auth = window.ExamFlowCore?.auth;
  const db = window.ExamFlowCore?.db;
  const storage = window.ExamFlowCore?.storage;
  const $ = id => document.getElementById(id);

  if (!auth || !db || !storage) {
    console.error("ExamFlow Admin: Firebase core chưa sẵn sàng.");
    return;
  }

  const INTERFACE_CACHE_KEY = "examflow-global-interface";
  const DASHBOARD_HERO_CACHE_KEY = "examflow-dashboard-hero";
  const SYSTEM_BANNERS_CACHE_KEY = "examflow-system-banners";
  const MAX_THEME_FILE_SIZE = 8 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const ADMIN_COLLECTIONS = [
    "users",
    "hoc_phan",
    "ghi_danh",
    "de_thi",
    "bai_nop",
    "trac_nghiem",
    "bai_lam_trac_nghiem"
  ];

  const adminState = {
    users: [],
    courses: [],
    enrollments: [],
    exams: [],
    submissions: [],
    quizzes: [],
    quizAttempts: [],
    selectedUser: null,
    loading: false,
    loadedAt: 0,
    activeView: "overview",
    activeFileView: "exams",
    currentConfig: null,
    interfaceUnsubscribe: null,
    localPreviewUrl: "",
    dashboardHeroConfig: null,
    dashboardHeroUnsubscribe: null,
    dashboardHeroPreviewUrl: "",
    bannerConfigs: new Map(),
    bannerUnsubscribe: null,
    selectedBannerId: "login",
    bannerPreviewUrl: "",
    errors: new Map()
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
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeRole(role) {
    return role === "admin" || role === "giaovien" || role === "hocsinh" ? role : "hocsinh";
  }

  function roleLabel(role) {
    return role === "admin" ? "Quản trị viên" : role === "giaovien" ? "Giáo viên" : "Sinh viên";
  }

  function roleClass(role) {
    return role === "admin" ? "admin" : role === "giaovien" ? "teacher" : "student";
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

  function valueToDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value?.toDate === "function") return value.toDate();
    if (Number.isFinite(value?.seconds)) return new Date(value.seconds * 1000);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function timestampMs(value) {
    return valueToDate(value)?.getTime() || 0;
  }

  function formatDate(value) {
    const date = valueToDate(value);
    return date ? date.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }) : "—";
  }

  function relativeDate(value) {
    const date = valueToDate(value);
    if (!date) return "Không rõ thời gian";
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return "Vừa xong";
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} phút trước`;
    if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} giờ trước`;
    if (diff < 604_800_000) return `${Math.max(1, Math.floor(diff / 86_400_000))} ngày trước`;
    return formatDate(date);
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function scoreNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(10, number)) : null;
  }

  function average(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  }

  function formatScoreValue(value) {
    const number = scoreNumber(value);
    return number === null ? "—" : number.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  }

  function scoreTone(score) {
    if (score === null) return "pending";
    if (score >= 8) return "high";
    if (score >= 5) return "pass";
    return "low";
  }

  function safeLinkUrl(value) {
    const url = String(value || "").trim();
    return /^https:\/\//i.test(url) ? url.replace(/["'<>\s]/g, char => encodeURIComponent(char)) : "";
  }

  function fileLink(url, label = "Mở file") {
    const safe = safeLinkUrl(url);
    return safe
      ? `<a class="admin-file-link" href="${safe}" target="_blank" rel="noopener">${escapeHtml(label)} ↗</a>`
      : '<span class="admin-file-unavailable">Không có URL</span>';
  }

  function isAdmin() {
    return core()?.currentRole === "admin";
  }

  function requireAdmin() {
    if (!auth.currentUser || !isAdmin()) {
      toast("Chức năng này chỉ dành cho quản trị viên.", false);
      return false;
    }
    return true;
  }

  function setText(id, value) {
    if ($(id)) $(id).textContent = value;
  }

  function setSyncStatus(message, mode = "ready") {
    const root = $("admin-sync-status");
    if (!root) return;
    root.dataset.mode = mode;
    const label = root.querySelector("span");
    if (label) label.textContent = message;
  }

  function setUsersStatus(message, mode = "ready") {
    const root = $("admin-users-status");
    if (!root) return;
    root.textContent = message;
    root.dataset.mode = mode;
  }

  function setThemeNote(message, mode = "ready") {
    const root = $("admin-theme-note");
    if (!root) return;
    root.textContent = message;
    root.dataset.mode = mode;
  }

  function courseMap() {
    return new Map(adminState.courses.map(item => [item.id, item]));
  }

  function userMap() {
    return new Map(adminState.users.map(item => [item.id, item]));
  }

  function quizMap() {
    return new Map(adminState.quizzes.map(item => [item.id, item]));
  }

  function courseLabel(item) {
    if (!item) return "Học phần không xác định";
    const code = String(item.maHocPhan || "").trim();
    const name = String(item.tenHocPhan || "").trim();
    if (!code) return name || "Học phần";
    if (!name || normalize(code) === normalize(name)) return code;
    return `${code} — ${name}`;
  }

  function teacherName(course) {
    const profile = userMap().get(course?.giaoVienId);
    return course?.giaoVienTen || profile?.hoTen || profile?.email || "Chưa xác định";
  }

  function studentName(item) {
    const profile = userMap().get(item?.uid);
    return item?.hoTen || profile?.hoTen || item?.email || profile?.email || "Sinh viên";
  }

  async function readAdminCollection(name) {
    try {
      const snapshot = await getDocs(collection(db, name));
      return { name, data: snapshot.docs.map(item => ({ id: item.id, ...item.data() })), error: null };
    } catch (error) {
      console.error(`Admin load ${name} failed:`, error);
      return { name, data: [], error };
    }
  }

  async function loadAdminData(force = false) {
    if (!requireAdmin() || adminState.loading) return;
    if (!force && adminState.loadedAt && Date.now() - adminState.loadedAt < 30_000) {
      renderAdminAll();
      return;
    }

    adminState.loading = true;
    adminState.errors.clear();
    setSyncStatus("Đang đồng bộ dữ liệu...", "loading");
    setUsersStatus("Đang tải...", "loading");

    try {
      const results = await Promise.all(ADMIN_COLLECTIONS.map(readAdminCollection));
      results.forEach(result => {
        if (result.error) adminState.errors.set(result.name, result.error);
        if (result.name === "users") adminState.users = result.data;
        if (result.name === "hoc_phan") adminState.courses = result.data;
        if (result.name === "ghi_danh") adminState.enrollments = result.data;
        if (result.name === "de_thi") adminState.exams = result.data;
        if (result.name === "bai_nop") adminState.submissions = result.data;
        if (result.name === "trac_nghiem") adminState.quizzes = result.data;
        if (result.name === "bai_lam_trac_nghiem") adminState.quizAttempts = result.data;
      });

      adminState.users.sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
      adminState.courses.sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
      adminState.exams.sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
      adminState.submissions.sort((a, b) => timestampMs(b.submittedAtClient || b.createdAt) - timestampMs(a.submittedAtClient || a.createdAt));
      adminState.quizAttempts.sort((a, b) => timestampMs(b.createdAt || b.nopAtClient) - timestampMs(a.createdAt || a.nopAtClient));
      adminState.loadedAt = Date.now();

      populateAdminFilters();
      renderAdminAll();

      if (adminState.errors.size) {
        const names = [...adminState.errors.keys()].join(", ");
        setSyncStatus(`Thiếu quyền đọc: ${names}`, "warning");
        toast(`Một số dữ liệu chưa tải được: ${names}. Hãy Publish firestore.rules mới.`, false);
      } else {
        setSyncStatus(`Đã đồng bộ lúc ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`, "ready");
      }
    } catch (error) {
      console.error("Admin data load error:", error);
      setSyncStatus("Đồng bộ thất bại", "error");
      toast("Không tải được dữ liệu quản trị: " + (error.message || error), false);
    } finally {
      adminState.loading = false;
    }
  }

  function assignmentScoreRecords() {
    return adminState.submissions.map(item => ({
      id: item.id,
      type: "assignment",
      typeLabel: "Bài nộp",
      student: studentName(item),
      uid: item.uid || "",
      courseId: item.hocPhanId || "",
      course: item.tenHocPhan || item.maHocPhan || courseLabel(courseMap().get(item.hocPhanId)),
      title: item.tenDeThi || item.tenFile || "Bài nộp",
      score: scoreNumber(item.diem),
      detail: item.nhanXet || (item.isLate ? item.lateLabel || "Nộp muộn" : "Bài tự luận"),
      date: item.gradedAt || item.submittedAtClient || item.createdAt,
      violations: null,
      url: item.url || ""
    }));
  }

  function quizScoreRecords() {
    const quizzes = quizMap();
    return adminState.quizAttempts.map(item => {
      const quiz = quizzes.get(item.quizId);
      return {
        id: item.id,
        type: "quiz",
        typeLabel: "Trắc nghiệm",
        student: studentName(item),
        uid: item.uid || "",
        courseId: item.hocPhanId || quiz?.hocPhanId || "",
        course: item.tenHocPhan || item.maHocPhan || quiz?.tenHocPhan || quiz?.maHocPhan || courseLabel(courseMap().get(item.hocPhanId || quiz?.hocPhanId)),
        title: item.tieuDe || quiz?.tieuDe || "Bài trắc nghiệm",
        score: scoreNumber(item.diem),
        detail: `${item.soCauDung ?? "—"}/${item.tongSoCau ?? "—"} câu đúng`,
        date: item.createdAt || item.nopAtClient,
        violations: Number(item.tongSoViPham || 0),
        url: ""
      };
    });
  }

  function allScoreRecords() {
    return [...assignmentScoreRecords(), ...quizScoreRecords()]
      .sort((a, b) => timestampMs(b.date) - timestampMs(a.date));
  }

  function updateAdminMetrics() {
    const countRole = role => adminState.users.filter(item => normalizeRole(item.role) === role).length;
    const graded = adminState.submissions.filter(item => scoreNumber(item.diem) !== null).length;
    const scoreRecords = allScoreRecords().filter(item => item.score !== null);
    const avg = average(scoreRecords.map(item => item.score));

    setText("admin-count-total", adminState.users.length.toLocaleString("vi-VN"));
    setText("admin-count-students", countRole("hocsinh").toLocaleString("vi-VN"));
    setText("admin-count-teachers", countRole("giaovien").toLocaleString("vi-VN"));
    setText("admin-count-courses", adminState.courses.length.toLocaleString("vi-VN"));
    setText("admin-count-exams", adminState.exams.length.toLocaleString("vi-VN"));
    setText("admin-count-submissions", adminState.submissions.length.toLocaleString("vi-VN"));
    setText("admin-count-graded", graded.toLocaleString("vi-VN"));
    setText("admin-average-score", avg === null ? "—" : avg.toLocaleString("vi-VN", { maximumFractionDigits: 2 }));

    setText("admin-role-total-shortcut", adminState.users.length.toLocaleString("vi-VN"));
    setText("admin-role-student-shortcut", countRole("hocsinh").toLocaleString("vi-VN"));
    setText("admin-role-teacher-shortcut", countRole("giaovien").toLocaleString("vi-VN"));
    setText("admin-role-admin-shortcut", countRole("admin").toLocaleString("vi-VN"));
    setText("admin-file-exam-count", adminState.exams.length.toLocaleString("vi-VN"));
    setText("admin-file-submission-count", adminState.submissions.length.toLocaleString("vi-VN"));
  }

  function setProgress(id, value) {
    const element = $(id);
    if (element) element.style.width = `${Math.max(0, Math.min(100, value))}%`;
  }

  function renderAdminOverview() {
    const graded = adminState.submissions.filter(item => scoreNumber(item.diem) !== null).length;
    const gradeRate = adminState.submissions.length ? graded / adminState.submissions.length * 100 : 0;
    const onTime = adminState.submissions.filter(item => item.isLate !== true).length;
    const onTimeRate = adminState.submissions.length ? onTime / adminState.submissions.length * 100 : 0;
    const enrolledStudents = new Set(adminState.enrollments.map(item => item.uid).filter(Boolean)).size;
    const totalStudents = adminState.users.filter(item => normalizeRole(item.role) === "hocsinh").length;
    const enrollmentRate = totalStudents ? enrolledStudents / totalStudents * 100 : 0;
    const scored = allScoreRecords().filter(item => item.score !== null);
    const avg = average(scored.map(item => item.score));

    setText("admin-health-grade-rate", `${Math.round(gradeRate)}%`);
    setText("admin-health-grade-note", `${graded}/${adminState.submissions.length} bài đã có điểm`);
    setProgress("admin-health-grade-bar", gradeRate);
    setText("admin-health-ontime-rate", `${Math.round(onTimeRate)}%`);
    setText("admin-health-ontime-note", adminState.submissions.length ? `${onTime}/${adminState.submissions.length} bài đúng hạn` : "Chưa có bài nộp");
    setProgress("admin-health-ontime-bar", onTimeRate);
    setText("admin-health-enrollment-rate", `${Math.round(enrollmentRate)}%`);
    setText("admin-health-enrollment-note", `${enrolledStudents}/${totalStudents} sinh viên đã ghi danh`);
    setProgress("admin-health-enrollment-bar", enrollmentRate);
    setText("admin-health-average", avg === null ? "—" : avg.toLocaleString("vi-VN", { maximumFractionDigits: 2 }));
    setText("admin-health-average-note", `${scored.length} kết quả đã có điểm`);
    setProgress("admin-health-average-bar", avg === null ? 0 : avg * 10);

    renderAdminActivity();
    renderAdminPeoplePreview("giaovien", "admin-teacher-preview");
    renderAdminPeoplePreview("hocsinh", "admin-student-preview");
  }

  function renderAdminActivity() {
    const activities = [];
    adminState.users.forEach(item => activities.push({
      type: "user", icon: normalizeRole(item.role) === "giaovien" ? "🧑‍🏫" : normalizeRole(item.role) === "admin" ? "🛡" : "🎓",
      title: item.hoTen || item.email || "Tài khoản mới", detail: `${roleLabel(normalizeRole(item.role))} được thêm vào hệ thống`, date: item.createdAt
    }));
    adminState.courses.forEach(item => activities.push({ type: "course", icon: "▦", title: courseLabel(item), detail: `Học phần của ${teacherName(item)}`, date: item.createdAt }));
    adminState.exams.forEach(item => activities.push({ type: "exam", icon: "⇧", title: item.moTa || item.tenFile || "Đề thi mới", detail: item.tenHocPhan || item.maHocPhan || "Đã gửi file đề", date: item.createdAt }));
    adminState.submissions.forEach(item => activities.push({ type: "submission", icon: "⇩", title: studentName(item), detail: `Đã nộp ${item.tenDeThi || item.tenFile || "bài làm"}`, date: item.submittedAtClient || item.createdAt }));

    const root = $("admin-recent-activity");
    if (!root) return;
    const recent = activities.sort((a, b) => timestampMs(b.date) - timestampMs(a.date)).slice(0, 10);
    root.innerHTML = recent.length ? recent.map(item => `
      <article class="admin-activity-item ${item.type}">
        <span>${item.icon}</span>
        <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div>
        <time>${escapeHtml(relativeDate(item.date))}</time>
      </article>`).join("") : '<div class="admin-empty-compact">Chưa có hoạt động để hiển thị.</div>';
  }

  function renderAdminPeoplePreview(role, rootId) {
    const root = $(rootId);
    if (!root) return;
    const isTeacher = role === "giaovien";
    const list = adminState.users.filter(item => normalizeRole(item.role) === role).slice(0, 6);
    root.innerHTML = list.length ? list.map(user => {
      const count = isTeacher
        ? adminState.courses.filter(item => item.giaoVienId === user.id).length
        : adminState.enrollments.filter(item => item.uid === user.id).length;
      return `<article class="admin-person-preview">
        <span class="admin-user-avatar ${roleClass(role)}">${escapeHtml(initials(user.hoTen || user.email))}</span>
        <div><strong>${escapeHtml(user.hoTen || user.email || "Người dùng")}</strong><small>${escapeHtml(user.email || user.maSo || "—")}</small></div>
        <b>${count} ${isTeacher ? "học phần" : "ghi danh"}</b>
      </article>`;
    }).join("") : `<div class="admin-empty-compact">Chưa có ${isTeacher ? "giáo viên" : "sinh viên"}.</div>`;
  }

  function filteredUsers() {
    const keyword = normalize($("admin-user-search")?.value || "");
    const role = $("admin-role-filter")?.value || "all";
    const status = $("admin-status-filter")?.value || "all";
    return adminState.users.filter(user => {
      const matchesKeyword = !keyword || normalize([user.hoTen, user.email, user.maSo, user.id].join(" ")).includes(keyword);
      const normalizedRole = normalizeRole(user.role);
      const matchesRole = role === "all" || normalizedRole === role;
      const matchesStatus = status === "all" || (status === "disabled" ? user.disabled === true : user.disabled !== true);
      return matchesKeyword && matchesRole && matchesStatus;
    });
  }

  function renderAdminUsers() {
    const body = $("admin-users-body");
    const empty = $("admin-users-empty");
    if (!body) return;
    const list = filteredUsers();
    setUsersStatus(`${list.length}/${adminState.users.length} tài khoản`, "ready");
    empty?.classList.toggle("hidden", list.length > 0);
    body.closest(".admin-users-table-wrap")?.classList.toggle("hidden", list.length === 0);

    body.innerHTML = list.map(user => {
      const role = normalizeRole(user.role);
      const disabled = user.disabled === true;
      const isSelf = user.id === auth.currentUser?.uid;
      const participation = role === "giaovien"
        ? `${adminState.courses.filter(item => item.giaoVienId === user.id).length} học phần`
        : role === "hocsinh"
          ? `${adminState.enrollments.filter(item => item.uid === user.id).length} ghi danh`
          : "Toàn hệ thống";
      return `<tr class="${disabled ? "is-disabled" : ""}">
        <td><div class="admin-user-cell"><span class="admin-user-avatar ${roleClass(role)}">${escapeHtml(initials(user.hoTen || user.email))}</span><div><strong>${escapeHtml(user.hoTen || "Chưa có tên")}${isSelf ? ' <em>Bạn</em>' : ""}</strong><small>${escapeHtml(user.email || "Chưa có email")}</small></div></div></td>
        <td>${escapeHtml(user.maSo || "—")}</td>
        <td><span class="admin-role-badge ${roleClass(role)}">${roleLabel(role)}</span></td>
        <td>${escapeHtml(participation)}</td>
        <td><span class="admin-status-badge ${disabled ? "disabled" : "active"}">${disabled ? "Tạm khóa" : "Hoạt động"}</span></td>
        <td>${escapeHtml(formatDate(user.createdAt))}</td>
        <td><button type="button" class="btn-sm admin-user-open" data-admin-user-id="${escapeHtml(user.id)}">Xem / Sửa</button></td>
      </tr>`;
    }).join("");

    body.querySelectorAll("[data-admin-user-id]").forEach(button => {
      button.addEventListener("click", () => openAdminUserModal(button.dataset.adminUserId));
    });
  }

  function filteredCourses() {
    const keyword = normalize($("admin-course-search")?.value || "");
    const teacherId = $("admin-course-teacher-filter")?.value || "all";
    return adminState.courses.filter(item => {
      const teacher = teacherName(item);
      return (!keyword || normalize([item.maHocPhan, item.tenHocPhan, teacher].join(" ")).includes(keyword))
        && (teacherId === "all" || item.giaoVienId === teacherId);
    });
  }

  function renderAdminCourses() {
    const body = $("admin-courses-body");
    const empty = $("admin-courses-empty");
    if (!body) return;
    const list = filteredCourses();
    setText("admin-courses-status", `${list.length}/${adminState.courses.length} học phần`);
    empty?.classList.toggle("hidden", list.length > 0);
    body.closest(".admin-data-table-wrap")?.classList.toggle("hidden", list.length === 0);

    body.innerHTML = list.map(course => {
      const enrollments = adminState.enrollments.filter(item => item.hocPhanId === course.id);
      const exams = adminState.exams.filter(item => item.hocPhanId === course.id);
      const submissions = adminState.submissions.filter(item => item.hocPhanId === course.id);
      const avg = average(submissions.map(item => scoreNumber(item.diem)).filter(Number.isFinite));
      return `<tr>
        <td><div class="admin-course-cell"><span>▦</span><div><strong>${escapeHtml(courseLabel(course))}</strong><small>ID: ${escapeHtml(course.id)}</small></div></div></td>
        <td>${escapeHtml(teacherName(course))}</td>
        <td><b class="admin-count-pill">${enrollments.length}</b></td>
        <td><b class="admin-count-pill blue">${exams.length}</b></td>
        <td><b class="admin-count-pill teal">${submissions.length}</b></td>
        <td><span class="admin-score-badge ${scoreTone(avg)}">${avg === null ? "—" : avg.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}</span></td>
        <td>${escapeHtml(formatDate(course.createdAt))}</td>
        <td><button type="button" class="admin-row-action" data-admin-course-files="${escapeHtml(course.id)}">Xem file →</button></td>
      </tr>`;
    }).join("");

    body.querySelectorAll("[data-admin-course-files]").forEach(button => {
      button.addEventListener("click", () => {
        switchAdminView("files");
        if ($("admin-file-course-filter")) $("admin-file-course-filter").value = button.dataset.adminCourseFiles;
        renderAdminFiles();
      });
    });
  }

  function filteredExams() {
    const keyword = normalize($("admin-file-search")?.value || "");
    const courseId = $("admin-file-course-filter")?.value || "all";
    return adminState.exams.filter(item => {
      const teacher = userMap().get(item.uploadedBy)?.hoTen || teacherName(courseMap().get(item.hocPhanId));
      return (!keyword || normalize([item.tenFile, item.moTa, item.maHocPhan, item.tenHocPhan, teacher].join(" ")).includes(keyword))
        && (courseId === "all" || item.hocPhanId === courseId);
    });
  }

  function filteredSubmissions() {
    const keyword = normalize($("admin-file-search")?.value || "");
    const courseId = $("admin-file-course-filter")?.value || "all";
    return adminState.submissions.filter(item => (!keyword || normalize([
      item.tenFile, item.tenDeThi, item.maHocPhan, item.tenHocPhan, studentName(item), item.maSo, item.email
    ].join(" ")).includes(keyword)) && (courseId === "all" || item.hocPhanId === courseId));
  }

  function renderAdminExams() {
    const body = $("admin-exams-body");
    const empty = $("admin-exams-empty");
    if (!body) return;
    const list = filteredExams();
    empty?.classList.toggle("hidden", list.length > 0);
    body.closest(".admin-data-table-wrap")?.classList.toggle("hidden", list.length === 0);
    body.innerHTML = list.map(item => {
      const teacher = userMap().get(item.uploadedBy)?.hoTen || teacherName(courseMap().get(item.hocPhanId));
      return `<tr>
        <td><div class="admin-file-cell"><span>⇧</span><div><strong>${escapeHtml(item.moTa || item.tenFile || "File đề")}</strong><small>${escapeHtml(item.tenFile || "—")}</small></div></div></td>
        <td>${escapeHtml(item.tenHocPhan || item.maHocPhan || courseLabel(courseMap().get(item.hocPhanId)))}</td>
        <td>${escapeHtml(teacher)}</td>
        <td>${escapeHtml(formatBytes(item.fileSize))}</td>
        <td>${escapeHtml(formatDate(item.deadlineAt))}</td>
        <td>${escapeHtml(formatDate(item.createdAt))}</td>
        <td>${fileLink(item.url, "Tải đề")}</td>
      </tr>`;
    }).join("");
  }

  function renderAdminSubmissions() {
    const body = $("admin-submissions-body");
    const empty = $("admin-submissions-empty");
    if (!body) return;
    const list = filteredSubmissions();
    empty?.classList.toggle("hidden", list.length > 0);
    body.closest(".admin-data-table-wrap")?.classList.toggle("hidden", list.length === 0);
    body.innerHTML = list.map(item => {
      const score = scoreNumber(item.diem);
      const late = item.isLate === true;
      return `<tr>
        <td><div class="admin-user-cell compact"><span class="admin-user-avatar student">${escapeHtml(initials(studentName(item)))}</span><div><strong>${escapeHtml(studentName(item))}</strong><small>${escapeHtml(item.maSo || item.email || "—")}</small></div></div></td>
        <td><div class="admin-table-stack"><strong>${escapeHtml(item.tenHocPhan || item.maHocPhan || courseLabel(courseMap().get(item.hocPhanId)))}</strong><small>${escapeHtml(item.tenDeThi || "Bài nộp")}</small></div></td>
        <td><div class="admin-table-stack"><strong>${escapeHtml(item.tenFile || "Bài làm")}</strong><small>${escapeHtml(formatBytes(item.fileSize))}</small></div></td>
        <td><span class="admin-status-badge ${late ? "disabled" : "active"}">${escapeHtml(late ? item.lateLabel || "Nộp muộn" : "Đúng hạn")}</span></td>
        <td><span class="admin-score-badge ${scoreTone(score)}">${formatScoreValue(score)}</span></td>
        <td>${escapeHtml(formatDate(item.submittedAtClient || item.createdAt))}</td>
        <td>${fileLink(item.url, "Tải bài")}</td>
      </tr>`;
    }).join("");
  }

  function renderAdminFiles() {
    const examsPanel = $("admin-exams-panel");
    const submissionsPanel = $("admin-submissions-panel");
    const isExamView = adminState.activeFileView === "exams";
    examsPanel?.classList.toggle("hidden", !isExamView);
    submissionsPanel?.classList.toggle("hidden", isExamView);
    document.querySelectorAll("[data-admin-file-view]").forEach(button => button.classList.toggle("active", button.dataset.adminFileView === adminState.activeFileView));
    renderAdminExams();
    renderAdminSubmissions();
    const count = isExamView ? filteredExams().length : filteredSubmissions().length;
    setText("admin-files-status", `${count} bản ghi đang hiển thị`);
  }

  function filteredScores() {
    const keyword = normalize($("admin-score-search")?.value || "");
    const courseId = $("admin-score-course-filter")?.value || "all";
    const type = $("admin-score-type-filter")?.value || "all";
    const status = $("admin-score-status-filter")?.value || "all";
    return allScoreRecords().filter(item => {
      const keywordMatch = !keyword || normalize([item.student, item.course, item.title, item.detail].join(" ")).includes(keyword);
      const courseMatch = courseId === "all" || item.courseId === courseId;
      const typeMatch = type === "all" || item.type === type;
      const statusMatch = status === "all"
        || (status === "graded" && item.score !== null)
        || (status === "pending" && item.score === null)
        || (status === "high" && item.score !== null && item.score >= 8)
        || (status === "low" && item.score !== null && item.score < 5);
      return keywordMatch && courseMatch && typeMatch && statusMatch;
    });
  }

  function renderAdminScores() {
    const body = $("admin-scores-body");
    const empty = $("admin-scores-empty");
    if (!body) return;
    const all = allScoreRecords();
    const list = filteredScores();
    const scored = all.filter(item => item.score !== null);
    const avg = average(scored.map(item => item.score));
    const passed = scored.filter(item => item.score >= 5).length;
    const highest = scored.slice().sort((a, b) => b.score - a.score)[0];
    const pending = assignmentScoreRecords().filter(item => item.score === null).length;

    setText("admin-score-average", avg === null ? "—" : avg.toLocaleString("vi-VN", { maximumFractionDigits: 2 }));
    setText("admin-score-pass-rate", scored.length ? `${Math.round(passed / scored.length * 100)}%` : "0%");
    setText("admin-score-pass-note", `${passed}/${scored.length} kết quả đạt`);
    setText("admin-score-highest", highest ? formatScoreValue(highest.score) : "—");
    setText("admin-score-highest-note", highest ? `${highest.student} · ${highest.title}` : "Chưa có dữ liệu");
    setText("admin-score-pending", pending.toLocaleString("vi-VN"));
    setText("admin-scores-status", `${list.length}/${all.length} kết quả`);

    empty?.classList.toggle("hidden", list.length > 0);
    body.closest(".admin-data-table-wrap")?.classList.toggle("hidden", list.length === 0);
    body.innerHTML = list.map(item => {
      const score = item.score;
      const details = item.type === "quiz"
        ? `${escapeHtml(item.detail)}${item.violations ? ` · ${item.violations} vi phạm` : ""}`
        : escapeHtml(item.detail);
      return `<tr>
        <td><div class="admin-user-cell compact"><span class="admin-user-avatar student">${escapeHtml(initials(item.student))}</span><div><strong>${escapeHtml(item.student)}</strong><small>${escapeHtml(item.uid || "—")}</small></div></div></td>
        <td>${escapeHtml(item.course)}</td>
        <td>${escapeHtml(item.title)}</td>
        <td><span class="admin-type-badge ${item.type}">${escapeHtml(item.typeLabel)}</span></td>
        <td><span class="admin-score-badge ${scoreTone(score)}">${formatScoreValue(score)}</span></td>
        <td><span class="admin-status-badge ${score === null ? "pending" : "active"}">${score === null ? "Chờ chấm" : score >= 5 ? "Đạt" : "Chưa đạt"}</span></td>
        <td><div class="admin-score-detail">${details}${item.url ? ` · ${fileLink(item.url, "Xem bài")}` : ""}</div></td>
        <td>${escapeHtml(formatDate(item.date))}</td>
      </tr>`;
    }).join("");
  }

  function populateSelect(select, options, currentValue = "all") {
    if (!select) return;
    const defaultOption = select.querySelector('option[value="all"]')?.outerHTML || '<option value="all">Tất cả</option>';
    select.innerHTML = defaultOption + options.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("");
    select.value = options.some(item => item.value === currentValue) ? currentValue : "all";
  }

  function populateAdminFilters() {
    const teacherCurrent = $("admin-course-teacher-filter")?.value || "all";
    const teachers = adminState.users
      .filter(item => normalizeRole(item.role) === "giaovien")
      .map(item => ({ value: item.id, label: item.hoTen || item.email || item.id }))
      .sort((a, b) => a.label.localeCompare(b.label, "vi"));
    populateSelect($("admin-course-teacher-filter"), teachers, teacherCurrent);

    const courseOptions = adminState.courses.map(item => ({ value: item.id, label: courseLabel(item) }))
      .sort((a, b) => a.label.localeCompare(b.label, "vi"));
    populateSelect($("admin-file-course-filter"), courseOptions, $("admin-file-course-filter")?.value || "all");
    populateSelect($("admin-score-course-filter"), courseOptions, $("admin-score-course-filter")?.value || "all");
  }

  function renderAdminAll() {
    updateAdminMetrics();
    renderAdminOverview();
    renderAdminUsers();
    renderAdminCourses();
    renderAdminFiles();
    renderAdminScores();
    syncThemeControls();
  }

  function switchAdminView(view) {
    const allowed = new Set(["overview", "users", "courses", "files", "scores", "theme"]);
    adminState.activeView = allowed.has(view) ? view : "overview";
    document.querySelectorAll("[data-admin-view]").forEach(button => button.classList.toggle("active", button.dataset.adminView === adminState.activeView));
    document.querySelectorAll(".admin-view-panel").forEach(panel => panel.classList.toggle("hidden", panel.id !== `admin-view-${adminState.activeView}`));
    if (adminState.activeView === "users") renderAdminUsers();
    if (adminState.activeView === "courses") renderAdminCourses();
    if (adminState.activeView === "files") renderAdminFiles();
    if (adminState.activeView === "scores") renderAdminScores();
    if (adminState.activeView === "theme") syncThemeControls();
  }

  function switchAdminFileView(view) {
    adminState.activeFileView = view === "submissions" ? "submissions" : "exams";
    renderAdminFiles();
  }

  function openAdminUserModal(userId) {
    if (!requireAdmin()) return;
    const user = adminState.users.find(item => item.id === userId);
    if (!user) return toast("Không tìm thấy thông tin người dùng.", false);
    adminState.selectedUser = user;
    const self = user.id === auth.currentUser.uid;
    $("admin-edit-user-id").value = user.id;
    $("admin-edit-name").value = user.hoTen || "";
    $("admin-edit-code").value = user.maSo || "";
    $("admin-edit-email").value = user.email || "";
    $("admin-edit-role").value = normalizeRole(user.role);
    $("admin-edit-role").disabled = self;
    $("admin-edit-created").value = formatDate(user.createdAt);
    $("admin-edit-disabled").checked = user.disabled === true;
    $("admin-edit-disabled").disabled = self;
    $("admin-edit-avatar").textContent = initials(user.hoTen || user.email);
    $("admin-edit-display-name").textContent = user.hoTen || user.email || "Người dùng";
    $("admin-edit-uid").textContent = `UID: ${user.id}`;
    const warning = $("admin-edit-warning");
    warning.classList.toggle("hidden", !self);
    warning.textContent = self ? "Tài khoản quản trị đang đăng nhập không thể tự hạ quyền hoặc tự khóa." : "";
    $("admin-user-modal").classList.remove("hidden");
  }

  function closeAdminUserModal() {
    adminState.selectedUser = null;
    $("admin-user-modal")?.classList.add("hidden");
  }

  async function saveAdminUser() {
    if (!requireAdmin()) return;
    const user = adminState.selectedUser;
    if (!user) return;
    const hoTen = $("admin-edit-name").value.trim();
    const maSo = $("admin-edit-code").value.trim();
    const self = user.id === auth.currentUser.uid;
    const role = self ? "admin" : normalizeRole($("admin-edit-role").value);
    const disabled = self ? false : $("admin-edit-disabled").checked;
    if (!hoTen) return toast("Họ và tên không được để trống.", false);

    const button = $("btn-save-admin-user");
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Đang lưu...";
    try {
      await updateDoc(doc(db, "users", user.id), {
        hoTen,
        hoTenKey: normalize(hoTen),
        maSo,
        role,
        disabled,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
      });
      await setDoc(doc(db, "danh_ba_cong_khai", user.id), {
        uid: user.id,
        hoTen,
        hoTenKey: normalize(hoTen),
        role,
        updatedAt: serverTimestamp()
      }, { merge: true });

      if (self) {
        await updateProfile(auth.currentUser, { displayName: hoTen }).catch(() => {});
        try {
          localStorage.setItem(`examflow-profile:${user.id}`, JSON.stringify({ hoTen, role: "admin", maSo, cachedAt: Date.now() }));
        } catch {}
        setText("sb-name", hoTen);
        setText("topbar-user-name", hoTen);
        setText("profile-popover-name", hoTen);
      }

      toast("Đã cập nhật thông tin người dùng.");
      closeAdminUserModal();
      adminState.loadedAt = 0;
      await loadAdminData(true);
    } catch (error) {
      console.error("Admin user update error:", error);
      toast("Không lưu được thay đổi: " + (error.message || error), false);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function cacheInterfaceConfig(config) {
    try {
      localStorage.setItem(INTERFACE_CACHE_KEY, JSON.stringify({
        imageUrl: config?.imageUrl || "",
        imagePath: config?.imagePath || "",
        target: config?.target || "both",
        overlay: Number.isFinite(Number(config?.overlay)) ? Number(config.overlay) : 0.48,
        updatedAtClient: Date.now()
      }));
    } catch {}
  }

  function readCachedInterfaceConfig() {
    try {
      return JSON.parse(localStorage.getItem(INTERFACE_CACHE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function safeCssUrl(value) {
    const url = String(value || "").trim();
    if (!/^https:\/\//i.test(url)) return "";
    return url.replace(/["\\\n\r]/g, char => encodeURIComponent(char));
  }

  function applyInterfaceConfig(config = {}) {
    const imageUrl = safeCssUrl(config.imageUrl);
    const target = ["login", "app", "both"].includes(config.target) ? config.target : "both";
    const overlay = Math.max(0, Math.min(0.8, Number(config.overlay ?? 0.48)));
    adminState.currentConfig = { ...config, imageUrl, target, overlay };
    document.documentElement.style.setProperty("--admin-interface-overlay", String(overlay));
    document.documentElement.style.setProperty("--admin-interface-image", imageUrl ? `url("${imageUrl}")` : "none");
    document.body.classList.toggle("has-admin-interface-image", Boolean(imageUrl));
    document.body.classList.toggle("admin-bg-login", Boolean(imageUrl) && (target === "login" || target === "both"));
    document.body.classList.toggle("admin-bg-app", Boolean(imageUrl) && (target === "app" || target === "both"));
    cacheInterfaceConfig(adminState.currentConfig);
    syncThemeControls();
  }

  function syncThemeControls() {
    const config = adminState.currentConfig || {};
    const preview = $("admin-theme-preview-image");
    const empty = $("admin-theme-preview-empty");
    if (preview && empty && !adminState.localPreviewUrl) {
      if (config.imageUrl) {
        preview.src = config.imageUrl;
        preview.classList.remove("hidden");
        empty.classList.add("hidden");
      } else {
        preview.removeAttribute("src");
        preview.classList.add("hidden");
        empty.classList.remove("hidden");
      }
    }
    if ($("admin-theme-target")) $("admin-theme-target").value = config.target || "both";
    const overlayPercent = Math.round(Number(config.overlay ?? 0.48) * 100);
    if ($("admin-theme-overlay")) $("admin-theme-overlay").value = String(overlayPercent);
    setText("admin-overlay-value", `${overlayPercent}%`);
    if ($("btn-admin-theme-remove")) $("btn-admin-theme-remove").disabled = !config.imageUrl;
  }

  function startInterfaceConfigListener() {
    adminState.interfaceUnsubscribe?.();
    adminState.interfaceUnsubscribe = onSnapshot(
      doc(db, "system_config", "interface"),
      snapshot => applyInterfaceConfig(snapshot.exists() ? snapshot.data() : {}),
      error => {
        console.warn("Không đọc được cấu hình giao diện hệ thống:", error);
        const cached = readCachedInterfaceConfig();
        if (cached) applyInterfaceConfig(cached);
      }
    );
  }



  const SYSTEM_BANNER_DEFINITIONS = [
    {
      id: "login",
      label: "Đăng nhập & đăng ký",
      kind: "login",
      defaults: {
        icon: "UNETI",
        eyebrow: "UNETI · DIGITAL CAMPUS",
        title: "Đăng nhập hệ thống",
        description: "Sử dụng tài khoản giáo viên, sinh viên hoặc quản trị viên để tiếp tục.",
        position: "center",
        overlay: 0.16,
        enabled: true
      }
    },
    {
      id: "admin-command",
      label: "Trung tâm quản trị",
      kind: "admin-command",
      defaults: {
        icon: "▣",
        eyebrow: "EXAMFLOW CONTROL CENTER",
        title: "Trung tâm quản trị",
        description: "Theo dõi người dùng, học phần, đề đã gửi, bài đã nộp và kết quả học tập trong một không gian thống nhất.",
        position: "center",
        overlay: 0.48,
        enabled: true
      }
    },
    ...Object.entries(PREMIUM_PAGE_META)
      .filter(([pageId]) => pageId !== "page-admin")
      .map(([pageId, meta]) => ({
        id: pageId,
        label: `Trang · ${meta.title}`,
        kind: "premium-page",
        defaults: {
          icon: meta.icon || "◆",
          eyebrow: meta.eyebrow || "EXAMFLOW",
          title: meta.title || "Banner trang",
          description: meta.description || "",
          position: "center",
          overlay: 0.48,
          enabled: true
        }
      }))
  ];

  function bannerDefinition(id = adminState.selectedBannerId) {
    return SYSTEM_BANNER_DEFINITIONS.find(item => item.id === id) || SYSTEM_BANNER_DEFINITIONS[0];
  }

  function bannerPositionValue(position) {
    return position === "left" ? "left center" : position === "right" ? "right center" : "center center";
  }

  function normalizeSystemBannerConfig(id, config = {}) {
    const definition = bannerDefinition(id);
    const defaults = definition.defaults;
    return {
      bannerId: definition.id,
      kind: definition.kind,
      icon: String(config.icon ?? defaults.icon).trim().slice(0, 12) || defaults.icon,
      eyebrow: String(config.eyebrow ?? defaults.eyebrow).trim().slice(0, 100) || defaults.eyebrow,
      title: String(config.title ?? defaults.title).trim().slice(0, 160) || defaults.title,
      description: String(config.description ?? defaults.description).trim().slice(0, 360),
      imageUrl: safeCssUrl(config.imageUrl),
      imagePath: String(config.imagePath || ""),
      position: ["left", "center", "right"].includes(config.position) ? config.position : defaults.position,
      overlay: Math.max(0, Math.min(.8, Number(config.overlay ?? defaults.overlay))),
      enabled: config.enabled !== false,
      updatedAt: config.updatedAt || null,
      updatedBy: String(config.updatedBy || "")
    };
  }

  function cacheSystemBanners() {
    try {
      localStorage.setItem(SYSTEM_BANNERS_CACHE_KEY, JSON.stringify(Object.fromEntries(adminState.bannerConfigs)));
    } catch {}
  }

  function readCachedSystemBanners() {
    try {
      const raw = JSON.parse(localStorage.getItem(SYSTEM_BANNERS_CACHE_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  function applyLoginBanner(config) {
    const root = document.documentElement;
    root.style.setProperty("--login-banner-image", config.imageUrl ? `url("${config.imageUrl}")` : 'url("uneti-campus-login.webp")');
    root.style.setProperty("--login-banner-position", bannerPositionValue(config.position));
    root.style.setProperty("--login-banner-overlay", String(config.overlay));
    const screen = $("screen-auth");
    if (screen) screen.style.display = config.enabled ? "" : "none";
    const schoolTag = document.querySelector("#screen-auth .auth-school-copy > span");
    const schoolTitle = document.querySelector("#screen-auth .auth-school-copy strong");
    const heading = document.querySelector("#screen-auth .auth-heading-block h2");
    const description = document.querySelector("#screen-auth .auth-heading-block p");
    if (schoolTag) schoolTag.textContent = config.eyebrow;
    if (schoolTitle) schoolTitle.textContent = config.title;
    if (heading) heading.textContent = config.title;
    if (description) description.textContent = config.description;
  }

  function applyAdminCommandBanner(config) {
    const hero = document.querySelector(".admin-command-hero");
    if (!hero) return;
    hero.classList.toggle("hidden", !config.enabled);
    hero.classList.toggle("has-custom-banner", Boolean(config.imageUrl));
    if (config.imageUrl) hero.style.setProperty("--admin-command-image", `url("${config.imageUrl}")`);
    else hero.style.removeProperty("--admin-command-image");
    hero.style.setProperty("--admin-command-position", bannerPositionValue(config.position));
    hero.style.setProperty("--admin-command-overlay", String(config.overlay));
    const kicker = hero.querySelector(".admin-kicker");
    const title = hero.querySelector("h1");
    const description = hero.querySelector("p");
    if (kicker) kicker.innerHTML = `<i></i>${escapeHtml(config.eyebrow)}`;
    if (title) title.textContent = config.title;
    if (description) description.textContent = config.description;
  }

  function applySystemBannerConfig(id, rawConfig = {}) {
    const config = normalizeSystemBannerConfig(id, rawConfig);
    adminState.bannerConfigs.set(id, config);
    window.ExamFlowBannerConfigs = window.ExamFlowBannerConfigs || {};
    window.ExamFlowBannerConfigs[id] = { ...config };

    if (config.kind === "login") applyLoginBanner(config);
    else if (config.kind === "admin-command") applyAdminCommandBanner(config);
    else if (config.kind === "premium-page") ensurePremiumPageHero(id);

    cacheSystemBanners();
    if (adminState.selectedBannerId === id) syncSystemBannerControls();
    window.dispatchEvent(new CustomEvent("examflow:system-banner-config", { detail: { id, config: { ...config } } }));
  }

  function applyAllSystemBannerConfigs(configs = {}) {
    SYSTEM_BANNER_DEFINITIONS.forEach(definition => {
      applySystemBannerConfig(definition.id, configs[definition.id] || {});
    });
  }

  function startSystemBannerConfigListener() {
    adminState.bannerUnsubscribe?.();
    adminState.bannerUnsubscribe = onSnapshot(
      collection(db, "system_banners"),
      snapshot => {
        const configs = {};
        snapshot.docs.forEach(item => { configs[item.id] = item.data(); });
        applyAllSystemBannerConfigs(configs);
      },
      error => {
        console.warn("Không đọc được collection system_banners:", error);
        applyAllSystemBannerConfigs(readCachedSystemBanners());
      }
    );
  }

  function populateSystemBannerSelect() {
    const select = $("admin-banner-select");
    if (!select) return;
    select.innerHTML = SYSTEM_BANNER_DEFINITIONS.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join("");
    select.value = adminState.selectedBannerId;
  }

  function cleanupSystemBannerPreview() {
    if (adminState.bannerPreviewUrl) URL.revokeObjectURL(adminState.bannerPreviewUrl);
    adminState.bannerPreviewUrl = "";
  }

  function currentSystemBannerConfig() {
    const id = adminState.selectedBannerId;
    return adminState.bannerConfigs.get(id) || normalizeSystemBannerConfig(id, {});
  }

  function renderSystemBannerPreview() {
    const config = normalizeSystemBannerConfig(adminState.selectedBannerId, {
      ...currentSystemBannerConfig(),
      icon: $("admin-banner-icon")?.value || currentSystemBannerConfig().icon,
      eyebrow: $("admin-banner-eyebrow")?.value || currentSystemBannerConfig().eyebrow,
      title: $("admin-banner-title")?.value || currentSystemBannerConfig().title,
      description: $("admin-banner-description")?.value ?? currentSystemBannerConfig().description,
      position: $("admin-banner-position")?.value || currentSystemBannerConfig().position,
      overlay: Number($("admin-banner-overlay")?.value || 48) / 100,
      enabled: $("admin-banner-enabled")?.checked !== false
    });
    const preview = $("admin-banner-preview");
    const image = adminState.bannerPreviewUrl || config.imageUrl;
    const leftAlpha = Math.min(1, config.overlay + .30);
    const rightAlpha = Math.max(.10, config.overlay - .18);
    if (preview) {
      preview.style.backgroundImage = image
        ? `linear-gradient(105deg, rgba(5,18,38,${leftAlpha}), rgba(12,35,62,${rightAlpha})), url("${image}")`
        : "linear-gradient(110deg, rgba(5,18,38,.88), rgba(20,40,76,.58)), linear-gradient(130deg, #073451, #126b78)";
      preview.style.backgroundPosition = bannerPositionValue(config.position);
      preview.style.opacity = config.enabled ? "1" : ".48";
    }
    setText("admin-banner-preview-icon", config.icon);
    setText("admin-banner-preview-eyebrow", config.eyebrow);
    setText("admin-banner-preview-title", config.title);
    setText("admin-banner-preview-description", config.description || "Không có mô tả.");
    setText("admin-banner-overlay-value", `${Math.round(config.overlay * 100)}%`);
  }

  function syncSystemBannerControls() {
    const config = currentSystemBannerConfig();
    if ($("admin-banner-select")) $("admin-banner-select").value = adminState.selectedBannerId;
    if ($("admin-banner-icon")) $("admin-banner-icon").value = config.icon;
    if ($("admin-banner-eyebrow")) $("admin-banner-eyebrow").value = config.eyebrow;
    if ($("admin-banner-title")) $("admin-banner-title").value = config.title;
    if ($("admin-banner-description")) $("admin-banner-description").value = config.description;
    if ($("admin-banner-position")) $("admin-banner-position").value = config.position;
    if ($("admin-banner-overlay")) $("admin-banner-overlay").value = String(Math.round(config.overlay * 100));
    if ($("admin-banner-enabled")) $("admin-banner-enabled").checked = config.enabled;
    renderSystemBannerPreview();
  }

  function setSystemBannerProgress(percent, visible = true) {
    $("admin-banner-progress-wrap")?.classList.toggle("hidden", !visible);
    if ($("admin-banner-progress")) $("admin-banner-progress").value = percent;
    setText("admin-banner-progress-text", `${Math.round(percent)}%`);
  }

  function setSystemBannerNote(message, mode = "") {
    const note = $("admin-banner-note");
    if (!note) return;
    note.textContent = message;
    note.dataset.mode = mode;
  }

  function systemBannerFormConfig(base = currentSystemBannerConfig()) {
    return normalizeSystemBannerConfig(adminState.selectedBannerId, {
      ...base,
      icon: $("admin-banner-icon")?.value || "",
      eyebrow: $("admin-banner-eyebrow")?.value || "",
      title: $("admin-banner-title")?.value || "",
      description: $("admin-banner-description")?.value || "",
      position: $("admin-banner-position")?.value || "center",
      overlay: Number($("admin-banner-overlay")?.value || 48) / 100,
      enabled: Boolean($("admin-banner-enabled")?.checked)
    });
  }

  async function saveSystemBannerContent() {
    if (!requireAdmin()) return;
    const config = systemBannerFormConfig();
    const button = $("btn-admin-banner-save");
    const original = button?.innerHTML || "";
    if (button) { button.disabled = true; button.innerHTML = "<span>Đang lưu...</span><b>…</b>"; }
    try {
      await setDoc(doc(db, "system_banners", config.bannerId), {
        bannerId: config.bannerId,
        kind: config.kind,
        icon: config.icon,
        eyebrow: config.eyebrow,
        title: config.title,
        description: config.description,
        imageUrl: config.imageUrl,
        imagePath: config.imagePath,
        position: config.position,
        overlay: config.overlay,
        enabled: config.enabled,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
      });
      applySystemBannerConfig(config.bannerId, config);
      setSystemBannerNote(`Đã cập nhật banner “${bannerDefinition(config.bannerId).label}”.`, "success");
      toast("Đã lưu nội dung banner.");
    } catch (error) {
      console.error("Save system banner error:", error);
      setSystemBannerNote("Không lưu được banner. Kiểm tra Firestore Rules.", "error");
      toast("Không lưu được banner: " + (error.message || error), false);
    } finally {
      if (button) { button.disabled = false; button.innerHTML = original; }
    }
  }

  function systemBannerFileName(name) {
    const ext = String(name || "image.webp").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "webp";
    return `banner_${Date.now()}.${ext}`;
  }

  function previewSelectedSystemBannerFile() {
    const input = $("admin-banner-file");
    const file = input?.files?.[0];
    cleanupSystemBannerPreview();
    if (!file) return renderSystemBannerPreview();
    if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_THEME_FILE_SIZE) {
      input.value = "";
      toast("Ảnh banner phải là JPG, PNG hoặc WebP và không vượt quá 8 MB.", false);
      return renderSystemBannerPreview();
    }
    adminState.bannerPreviewUrl = URL.createObjectURL(file);
    renderSystemBannerPreview();
    setSystemBannerNote(`Đã chọn ${file.name}. Nhấn “Tải ảnh và áp dụng” để lưu.`, "pending");
  }

  async function uploadSystemBannerImage() {
    if (!requireAdmin()) return;
    const file = $("admin-banner-file")?.files?.[0];
    if (!file) return toast("Hãy chọn ảnh banner trước.", false);
    if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_THEME_FILE_SIZE) return toast("Ảnh không hợp lệ hoặc vượt quá 8 MB.", false);

    const config = systemBannerFormConfig();
    const button = $("btn-admin-banner-upload");
    const original = button?.innerHTML || "";
    if (button) { button.disabled = true; button.innerHTML = "<span>Đang tải ảnh...</span>"; }
    setSystemBannerProgress(0, true);
    const previousPath = config.imagePath || "";
    const storagePath = `system-theme/banners/${config.bannerId}/${systemBannerFileName(file.name)}`;
    try {
      const task = uploadBytesResumable(ref(storage, storagePath), file, { contentType: file.type, cacheControl: "public,max-age=3600" });
      const snapshot = await new Promise((resolve, reject) => task.on("state_changed", progress => {
        const percent = progress.totalBytes ? progress.bytesTransferred / progress.totalBytes * 100 : 0;
        setSystemBannerProgress(percent, true);
      }, reject, () => resolve(task.snapshot)));
      const imageUrl = await getDownloadURL(snapshot.ref);
      const next = normalizeSystemBannerConfig(config.bannerId, { ...config, imageUrl, imagePath: storagePath });
      await setDoc(doc(db, "system_banners", next.bannerId), {
        bannerId: next.bannerId,
        kind: next.kind,
        icon: next.icon,
        eyebrow: next.eyebrow,
        title: next.title,
        description: next.description,
        imageUrl,
        imagePath: storagePath,
        position: next.position,
        overlay: next.overlay,
        enabled: next.enabled,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
      });
      if (previousPath && previousPath !== storagePath) deleteObject(ref(storage, previousPath)).catch(() => {});
      cleanupSystemBannerPreview();
      if ($("admin-banner-file")) $("admin-banner-file").value = "";
      applySystemBannerConfig(next.bannerId, next);
      setSystemBannerProgress(100, true);
      setSystemBannerNote("Ảnh banner đã được cập nhật cho toàn hệ thống.", "success");
      toast("Đã thay ảnh banner.");
      setTimeout(() => setSystemBannerProgress(0, false), 1200);
    } catch (error) {
      console.error("Upload system banner error:", error);
      setSystemBannerNote("Không tải được ảnh. Kiểm tra Storage Rules.", "error");
      toast("Không tải được ảnh banner: " + (error.message || error), false);
    } finally {
      if (button) { button.disabled = false; button.innerHTML = original; }
    }
  }

  async function resetSystemBanner() {
    if (!requireAdmin()) return;
    const id = adminState.selectedBannerId;
    const current = currentSystemBannerConfig();
    if (!confirm(`Khôi phục banner “${bannerDefinition(id).label}” về mặc định?`)) return;
    const defaults = normalizeSystemBannerConfig(id, {});
    const button = $("btn-admin-banner-reset");
    if (button) button.disabled = true;
    try {
      await setDoc(doc(db, "system_banners", id), {
        bannerId: defaults.bannerId,
        kind: defaults.kind,
        icon: defaults.icon,
        eyebrow: defaults.eyebrow,
        title: defaults.title,
        description: defaults.description,
        imageUrl: "",
        imagePath: "",
        position: defaults.position,
        overlay: defaults.overlay,
        enabled: true,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
      });
      if (current.imagePath) deleteObject(ref(storage, current.imagePath)).catch(() => {});
      cleanupSystemBannerPreview();
      if ($("admin-banner-file")) $("admin-banner-file").value = "";
      applySystemBannerConfig(id, defaults);
      setSystemBannerNote("Đã khôi phục banner về mặc định.", "success");
      toast("Đã khôi phục banner.");
    } catch (error) {
      console.error("Reset system banner error:", error);
      toast("Không khôi phục được banner: " + (error.message || error), false);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function normalizeDashboardHeroConfig(config = {}) {
    const imageUrl = safeCssUrl(config.imageUrl);
    const position = ["left", "center", "right"].includes(config.position) ? config.position : "center";
    const overlay = Math.max(0, Math.min(0.8, Number(config.overlay ?? 0.48)));
    const titleTemplate = String(config.titleTemplate || "{greeting}, {name}").trim().slice(0, 120) || "{greeting}, {name}";
    const subtitle = String(config.subtitle || "").trim().slice(0, 240);
    return {
      imageUrl,
      imagePath: String(config.imagePath || ""),
      position,
      overlay,
      titleTemplate,
      subtitle,
      updatedAt: config.updatedAt || null,
      updatedBy: String(config.updatedBy || "")
    };
  }

  function cacheDashboardHeroConfig(config) {
    try {
      localStorage.setItem(DASHBOARD_HERO_CACHE_KEY, JSON.stringify({
        ...config,
        updatedAtClient: Date.now()
      }));
    } catch {}
  }

  function readCachedDashboardHeroConfig() {
    try {
      return JSON.parse(localStorage.getItem(DASHBOARD_HERO_CACHE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function dashboardHeroPositionValue(position) {
    if (position === "left") return "left center";
    if (position === "right") return "right center";
    return "center center";
  }

  function dashboardGreetingPreview(template) {
    const hour = new Date().getHours();
    const timeGreeting = hour < 11 ? "Chào buổi sáng" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối";
    return String(template || "{greeting}, {name}")
      .replaceAll("{greeting}", timeGreeting)
      .replaceAll("{name}", "Nguyễn Văn A");
  }

  function applyDashboardHeroConfig(config = {}) {
    const normalized = normalizeDashboardHeroConfig(config);
    adminState.dashboardHeroConfig = normalized;

    document.documentElement.style.setProperty(
      "--dashboard-hero-image",
      normalized.imageUrl ? `url("${normalized.imageUrl}")` : 'url("uneti-dashboard-hero.webp")'
    );
    document.documentElement.style.setProperty("--dashboard-hero-overlay", String(normalized.overlay));
    document.documentElement.style.setProperty("--dashboard-hero-position", dashboardHeroPositionValue(normalized.position));

    window.ExamFlowDashboardHeroConfig = Object.freeze({ ...normalized });
    cacheDashboardHeroConfig(normalized);
    syncDashboardHeroControls();
    window.dispatchEvent(new CustomEvent("examflow:dashboard-hero-config", { detail: { ...normalized } }));
  }

  function syncDashboardHeroControls() {
    const config = adminState.dashboardHeroConfig || normalizeDashboardHeroConfig({});
    if ($("admin-dashboard-title-template")) $("admin-dashboard-title-template").value = config.titleTemplate;
    if ($("admin-dashboard-subtitle")) $("admin-dashboard-subtitle").value = config.subtitle;
    if ($("admin-dashboard-position")) $("admin-dashboard-position").value = config.position;
    const percent = Math.round(config.overlay * 100);
    if ($("admin-dashboard-overlay")) $("admin-dashboard-overlay").value = String(percent);
    setText("admin-dashboard-overlay-value", `${percent}%`);

    const preview = $("admin-dashboard-hero-preview");
    if (preview && !adminState.dashboardHeroPreviewUrl) {
      preview.style.backgroundImage = config.imageUrl
        ? `linear-gradient(90deg, rgba(3,17,29,${Math.min(.96, config.overlay + .34)}), rgba(3,17,29,${Math.max(.12, config.overlay - .08)})), url("${config.imageUrl}")`
        : "";
      preview.style.backgroundPosition = dashboardHeroPositionValue(config.position);
    }
    setText("admin-dashboard-preview-title", dashboardGreetingPreview(config.titleTemplate));
    setText(
      "admin-dashboard-preview-subtitle",
      config.subtitle || "Tiến độ học tập, lịch sắp tới và kết quả mới nhất đã sẵn sàng."
    );
    if ($("btn-admin-dashboard-reset")) {
      $("btn-admin-dashboard-reset").disabled =
        !config.imageUrl &&
        config.titleTemplate === "{greeting}, {name}" &&
        !config.subtitle &&
        config.position === "center" &&
        Math.abs(config.overlay - 0.48) < 0.001;
    }
  }

  function startDashboardHeroConfigListener() {
    adminState.dashboardHeroUnsubscribe?.();
    adminState.dashboardHeroUnsubscribe = onSnapshot(
      doc(db, "system_config", "dashboard_hero"),
      snapshot => applyDashboardHeroConfig(snapshot.exists() ? snapshot.data() : {}),
      error => {
        console.warn("Không đọc được cấu hình banner Dashboard:", error);
        const cached = readCachedDashboardHeroConfig();
        applyDashboardHeroConfig(cached || {});
      }
    );
  }

  function setDashboardProgress(percent, visible = true) {
    $("admin-dashboard-progress-wrap")?.classList.toggle("hidden", !visible);
    if ($("admin-dashboard-progress")) $("admin-dashboard-progress").value = percent;
    setText("admin-dashboard-progress-text", `${Math.round(percent)}%`);
  }

  function setDashboardNote(message, mode = "") {
    const note = $("admin-dashboard-note");
    if (!note) return;
    note.textContent = message;
    note.dataset.mode = mode;
  }

  function cleanupDashboardPreview() {
    if (adminState.dashboardHeroPreviewUrl) URL.revokeObjectURL(adminState.dashboardHeroPreviewUrl);
    adminState.dashboardHeroPreviewUrl = "";
  }

  function previewSelectedDashboardFile() {
    const file = $("admin-dashboard-hero-file")?.files?.[0];
    cleanupDashboardPreview();
    if (!file) return syncDashboardHeroControls();
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      $("admin-dashboard-hero-file").value = "";
      toast("Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.", false);
      return syncDashboardHeroControls();
    }
    if (file.size > MAX_THEME_FILE_SIZE) {
      $("admin-dashboard-hero-file").value = "";
      toast("Ảnh banner vượt quá dung lượng tối đa 8 MB.", false);
      return syncDashboardHeroControls();
    }
    adminState.dashboardHeroPreviewUrl = URL.createObjectURL(file);
    const preview = $("admin-dashboard-hero-preview");
    if (preview) {
      const overlay = Number($("admin-dashboard-overlay")?.value || 48) / 100;
      preview.style.backgroundImage =
        `linear-gradient(90deg, rgba(3,17,29,${Math.min(.96, overlay + .34)}), rgba(3,17,29,${Math.max(.12, overlay - .08)})), url("${adminState.dashboardHeroPreviewUrl}")`;
    }
    setDashboardNote(`Đã chọn ${file.name}. Nhấn “Tải ảnh và áp dụng” để lưu.`, "pending");
  }

  function dashboardHeroFormConfig(base = adminState.dashboardHeroConfig || {}) {
    return normalizeDashboardHeroConfig({
      ...base,
      titleTemplate: $("admin-dashboard-title-template")?.value || "{greeting}, {name}",
      subtitle: $("admin-dashboard-subtitle")?.value || "",
      position: $("admin-dashboard-position")?.value || "center",
      overlay: Number($("admin-dashboard-overlay")?.value || 48) / 100
    });
  }

  async function saveDashboardHeroContent() {
    if (!requireAdmin()) return;
    const button = $("btn-admin-dashboard-save");
    const original = button?.innerHTML || "";
    if (button) {
      button.disabled = true;
      button.innerHTML = "<span>Đang lưu...</span><b>…</b>";
    }
    try {
      const config = dashboardHeroFormConfig();
      await setDoc(doc(db, "system_config", "dashboard_hero"), {
        imageUrl: config.imageUrl,
        imagePath: config.imagePath,
        titleTemplate: config.titleTemplate,
        subtitle: config.subtitle,
        position: config.position,
        overlay: config.overlay,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
      });
      applyDashboardHeroConfig(config);
      setDashboardNote("Đã lưu nội dung banner Dashboard cho toàn hệ thống.", "success");
      toast("Đã cập nhật nội dung khu vực chào mừng.");
    } catch (error) {
      console.error("Save dashboard hero content error:", error);
      setDashboardNote("Không lưu được nội dung. Kiểm tra Firestore Rules.", "error");
      toast("Không lưu được banner Dashboard: " + (error.message || error), false);
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  }

  function dashboardHeroFileName(name) {
    const ext = String(name || "image.webp").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "webp";
    return `dashboard_${Date.now()}.${ext}`;
  }

  async function uploadDashboardHeroImage() {
    if (!requireAdmin()) return;
    const file = $("admin-dashboard-hero-file")?.files?.[0];
    if (!file) return toast("Hãy chọn ảnh nền Dashboard trước.", false);
    if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_THEME_FILE_SIZE) {
      return toast("Ảnh không hợp lệ hoặc vượt quá 8 MB.", false);
    }

    const button = $("btn-admin-dashboard-upload");
    const original = button?.innerHTML || "";
    if (button) {
      button.disabled = true;
      button.innerHTML = "<span>Đang tải ảnh...</span>";
    }
    setDashboardProgress(0, true);
    setDashboardNote("Đang tải ảnh banner lên Firebase Storage...", "loading");

    const previousPath = adminState.dashboardHeroConfig?.imagePath || "";
    const storagePath = `system-theme/dashboard-hero/${dashboardHeroFileName(file.name)}`;

    try {
      const storageRef = ref(storage, storagePath);
      const task = uploadBytesResumable(storageRef, file, {
        contentType: file.type,
        cacheControl: "public,max-age=3600"
      });
      const snapshot = await new Promise((resolve, reject) => {
        task.on("state_changed", progress => {
          const percent = progress.totalBytes ? progress.bytesTransferred / progress.totalBytes * 100 : 0;
          setDashboardProgress(percent, true);
        }, reject, () => resolve(task.snapshot));
      });
      const imageUrl = await getDownloadURL(snapshot.ref);
      const config = dashboardHeroFormConfig({
        ...(adminState.dashboardHeroConfig || {}),
        imageUrl,
        imagePath: storagePath
      });
      await setDoc(doc(db, "system_config", "dashboard_hero"), {
        imageUrl,
        imagePath: storagePath,
        titleTemplate: config.titleTemplate,
        subtitle: config.subtitle,
        position: config.position,
        overlay: config.overlay,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
      });
      if (previousPath && previousPath !== storagePath) {
        deleteObject(ref(storage, previousPath)).catch(error => console.warn("Không xóa được ảnh banner cũ:", error));
      }
      cleanupDashboardPreview();
      if ($("admin-dashboard-hero-file")) $("admin-dashboard-hero-file").value = "";
      applyDashboardHeroConfig(config);
      setDashboardProgress(100, true);
      setDashboardNote("Ảnh nền Dashboard đã được cập nhật cho toàn hệ thống.", "success");
      toast("Đã thay ảnh khu vực chào mừng Dashboard.");
      setTimeout(() => setDashboardProgress(0, false), 1200);
    } catch (error) {
      console.error("Dashboard hero upload error:", error);
      setDashboardNote("Không tải được ảnh. Kiểm tra Storage Rules và thử lại.", "error");
      toast("Không tải được ảnh banner Dashboard: " + (error.message || error), false);
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  }

  async function resetDashboardHero() {
    if (!requireAdmin()) return;
    if (!confirm("Khôi phục ảnh và nội dung khu vực chào mừng về mặc định?")) return;
    const current = adminState.dashboardHeroConfig || {};
    const button = $("btn-admin-dashboard-reset");
    if (button) button.disabled = true;
    try {
      const defaults = normalizeDashboardHeroConfig({});
      await setDoc(doc(db, "system_config", "dashboard_hero"), {
        imageUrl: "",
        imagePath: "",
        titleTemplate: defaults.titleTemplate,
        subtitle: "",
        position: "center",
        overlay: 0.48,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
      });
      if (current.imagePath) {
        await deleteObject(ref(storage, current.imagePath)).catch(error => console.warn("Không xóa được ảnh banner trên Storage:", error));
      }
      cleanupDashboardPreview();
      if ($("admin-dashboard-hero-file")) $("admin-dashboard-hero-file").value = "";
      applyDashboardHeroConfig(defaults);
      setDashboardNote("Đã khôi phục banner Dashboard về mặc định.", "success");
      toast("Đã khôi phục khu vực chào mừng.");
    } catch (error) {
      console.error("Reset dashboard hero error:", error);
      toast("Không khôi phục được banner Dashboard: " + (error.message || error), false);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setThemeUploadProgress(percent, visible = true) {
    $("admin-theme-progress-wrap")?.classList.toggle("hidden", !visible);
    if ($("admin-theme-progress")) $("admin-theme-progress").value = percent;
    setText("admin-theme-progress-text", `${Math.round(percent)}%`);
  }

  function cleanupLocalPreview() {
    if (adminState.localPreviewUrl) URL.revokeObjectURL(adminState.localPreviewUrl);
    adminState.localPreviewUrl = "";
  }

  function previewSelectedThemeFile() {
    const file = $("admin-theme-file")?.files?.[0];
    cleanupLocalPreview();
    if (!file) return syncThemeControls();
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      $("admin-theme-file").value = "";
      toast("Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.", false);
      return syncThemeControls();
    }
    if (file.size > MAX_THEME_FILE_SIZE) {
      $("admin-theme-file").value = "";
      toast("Ảnh vượt quá dung lượng tối đa 8 MB.", false);
      return syncThemeControls();
    }
    adminState.localPreviewUrl = URL.createObjectURL(file);
    const preview = $("admin-theme-preview-image");
    preview.src = adminState.localPreviewUrl;
    preview.classList.remove("hidden");
    $("admin-theme-preview-empty")?.classList.add("hidden");
    setThemeNote(`Đã chọn ${file.name}. Nhấn “Tải lên và áp dụng” để lưu.`, "pending");
  }

  function sanitizedFileName(name) {
    const ext = String(name || "image.webp").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "webp";
    return `interface_${Date.now()}.${ext}`;
  }

  async function uploadAdminTheme() {
    if (!requireAdmin()) return;
    const file = $("admin-theme-file")?.files?.[0];
    if (!file) return toast("Hãy chọn một ảnh trước khi tải lên.", false);
    if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_THEME_FILE_SIZE) return toast("Ảnh không hợp lệ hoặc vượt quá 8 MB.", false);

    const button = $("btn-admin-theme-upload");
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = "<span>Đang tải ảnh...</span><b>…</b>";
    setThemeUploadProgress(0, true);
    setThemeNote("Đang tải ảnh lên Firebase Storage...", "loading");
    const previousPath = adminState.currentConfig?.imagePath || "";
    const storagePath = `system-theme/interface/${sanitizedFileName(file.name)}`;

    try {
      const storageRef = ref(storage, storagePath);
      const task = uploadBytesResumable(storageRef, file, { contentType: file.type, cacheControl: "public,max-age=3600" });
      const snapshot = await new Promise((resolve, reject) => {
        task.on("state_changed", progress => {
          const percent = progress.totalBytes ? progress.bytesTransferred / progress.totalBytes * 100 : 0;
          setThemeUploadProgress(percent, true);
        }, reject, () => resolve(task.snapshot));
      });
      const imageUrl = await getDownloadURL(snapshot.ref);
      const target = $("admin-theme-target").value;
      const overlay = Number($("admin-theme-overlay").value) / 100;
      await setDoc(doc(db, "system_config", "interface"), {
        imageUrl,
        imagePath: storagePath,
        target,
        overlay,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
      });
      if (previousPath && previousPath !== storagePath) deleteObject(ref(storage, previousPath)).catch(error => console.warn("Không xóa được ảnh cũ:", error));
      cleanupLocalPreview();
      $("admin-theme-file").value = "";
      applyInterfaceConfig({ imageUrl, imagePath: storagePath, target, overlay });
      setThemeUploadProgress(100, true);
      setThemeNote("Ảnh giao diện đã được áp dụng cho toàn hệ thống.", "success");
      toast("Đã cập nhật ảnh giao diện hệ thống.");
      setTimeout(() => setThemeUploadProgress(0, false), 1200);
    } catch (error) {
      console.error("Admin theme upload error:", error);
      setThemeNote("Không thể tải ảnh. Kiểm tra Storage Rules và thử lại.", "error");
      toast("Không tải được ảnh giao diện: " + (error.message || error), false);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  async function removeAdminTheme() {
    if (!requireAdmin()) return;
    const current = adminState.currentConfig || {};
    if (!current.imageUrl || !confirm("Xóa ảnh giao diện hiện tại và trở về nền mặc định?")) return;
    const button = $("btn-admin-theme-remove");
    button.disabled = true;
    try {
      await setDoc(doc(db, "system_config", "interface"), {
        imageUrl: "",
        imagePath: "",
        target: "both",
        overlay: 0.48,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
      });
      if (current.imagePath) await deleteObject(ref(storage, current.imagePath)).catch(error => console.warn("Không xóa được ảnh trên Storage:", error));
      cleanupLocalPreview();
      $("admin-theme-file").value = "";
      applyInterfaceConfig({});
      setThemeNote("Đã trở về giao diện mặc định.", "success");
      toast("Đã xóa ảnh giao diện hệ thống.");
    } catch (error) {
      console.error("Admin theme remove error:", error);
      toast("Không xóa được ảnh giao diện: " + (error.message || error), false);
    } finally {
      button.disabled = false;
    }
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function downloadCsv(fileName, rows) {
    const csv = "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportAdminData() {
    const date = new Date().toISOString().slice(0, 10);
    if (adminState.activeView === "users") {
      const rows = [["Họ tên", "Email", "Mã số", "Vai trò", "Trạng thái", "UID", "Ngày tạo"]];
      filteredUsers().forEach(item => rows.push([item.hoTen, item.email, item.maSo, roleLabel(normalizeRole(item.role)), item.disabled ? "Tạm khóa" : "Hoạt động", item.id, formatDate(item.createdAt)]));
      downloadCsv(`examflow-nguoi-dung-${date}.csv`, rows);
    } else if (adminState.activeView === "courses") {
      const rows = [["Học phần", "Giáo viên", "Số sinh viên", "Số đề", "Số bài nộp", "Điểm trung bình", "Ngày tạo"]];
      filteredCourses().forEach(item => {
        const submissions = adminState.submissions.filter(s => s.hocPhanId === item.id);
        rows.push([courseLabel(item), teacherName(item), adminState.enrollments.filter(e => e.hocPhanId === item.id).length, adminState.exams.filter(e => e.hocPhanId === item.id).length, submissions.length, average(submissions.map(s => scoreNumber(s.diem)).filter(Number.isFinite)) ?? "", formatDate(item.createdAt)]);
      });
      downloadCsv(`examflow-hoc-phan-${date}.csv`, rows);
    } else if (adminState.activeView === "files") {
      if (adminState.activeFileView === "exams") {
        const rows = [["Tên file", "Mô tả", "Học phần", "Giáo viên", "Dung lượng", "Hạn nộp", "Ngày gửi", "URL"]];
        filteredExams().forEach(item => rows.push([item.tenFile, item.moTa, item.tenHocPhan || item.maHocPhan, userMap().get(item.uploadedBy)?.hoTen || teacherName(courseMap().get(item.hocPhanId)), formatBytes(item.fileSize), formatDate(item.deadlineAt), formatDate(item.createdAt), item.url]));
        downloadCsv(`examflow-file-de-${date}.csv`, rows);
      } else {
        const rows = [["Sinh viên", "Mã số", "Học phần", "Đề thi", "File", "Đúng hạn", "Điểm", "Thời gian", "URL"]];
        filteredSubmissions().forEach(item => rows.push([studentName(item), item.maSo, item.tenHocPhan || item.maHocPhan, item.tenDeThi, item.tenFile, item.isLate ? "Không" : "Có", scoreNumber(item.diem) ?? "", formatDate(item.submittedAtClient || item.createdAt), item.url]));
        downloadCsv(`examflow-bai-nop-${date}.csv`, rows);
      }
    } else if (adminState.activeView === "scores") {
      const rows = [["Sinh viên", "Học phần", "Bài đánh giá", "Loại", "Điểm", "Chi tiết", "Thời gian"]];
      filteredScores().forEach(item => rows.push([item.student, item.course, item.title, item.typeLabel, item.score ?? "", item.detail, formatDate(item.date)]));
      downloadCsv(`examflow-diem-so-${date}.csv`, rows);
    } else {
      const rows = [["Chỉ số", "Giá trị"], ["Tổng người dùng", adminState.users.length], ["Sinh viên", adminState.users.filter(item => normalizeRole(item.role) === "hocsinh").length], ["Giáo viên", adminState.users.filter(item => normalizeRole(item.role) === "giaovien").length], ["Học phần", adminState.courses.length], ["File đề", adminState.exams.length], ["Bài nộp", adminState.submissions.length], ["Kết quả trắc nghiệm", adminState.quizAttempts.length]];
      downloadCsv(`examflow-tong-quan-${date}.csv`, rows);
    }
    toast("Đã xuất dữ liệu CSV.");
  }

  function attachAdminEvents() {
    $("btn-admin-refresh")?.addEventListener("click", () => loadAdminData(true));
    $("btn-admin-export")?.addEventListener("click", exportAdminData);
    document.querySelectorAll("[data-admin-view]").forEach(button => button.addEventListener("click", () => switchAdminView(button.dataset.adminView)));
    document.querySelectorAll("[data-admin-file-view]").forEach(button => button.addEventListener("click", () => switchAdminFileView(button.dataset.adminFileView)));
    document.querySelectorAll("[data-admin-jump]").forEach(button => button.addEventListener("click", () => {
      switchAdminView("users");
      const role = button.dataset.adminJump === "teachers" ? "giaovien" : "hocsinh";
      if ($("admin-role-filter")) $("admin-role-filter").value = role;
      document.querySelectorAll("[data-admin-role-shortcut]").forEach(item => item.classList.toggle("active", item.dataset.adminRoleShortcut === role));
      renderAdminUsers();
    }));

    document.querySelectorAll("[data-admin-role-shortcut]").forEach(button => button.addEventListener("click", () => {
      const role = button.dataset.adminRoleShortcut;
      if ($("admin-role-filter")) $("admin-role-filter").value = role;
      document.querySelectorAll("[data-admin-role-shortcut]").forEach(item => item.classList.toggle("active", item === button));
      renderAdminUsers();
    }));

    $("admin-user-search")?.addEventListener("input", renderAdminUsers);
    $("admin-role-filter")?.addEventListener("change", event => {
      document.querySelectorAll("[data-admin-role-shortcut]").forEach(item => item.classList.toggle("active", item.dataset.adminRoleShortcut === event.target.value));
      renderAdminUsers();
    });
    $("admin-status-filter")?.addEventListener("change", renderAdminUsers);
    $("admin-course-search")?.addEventListener("input", renderAdminCourses);
    $("admin-course-teacher-filter")?.addEventListener("change", renderAdminCourses);
    $("admin-file-search")?.addEventListener("input", renderAdminFiles);
    $("admin-file-course-filter")?.addEventListener("change", renderAdminFiles);
    $("admin-score-search")?.addEventListener("input", renderAdminScores);
    ["admin-score-course-filter", "admin-score-type-filter", "admin-score-status-filter"].forEach(id => $(id)?.addEventListener("change", renderAdminScores));

    $("btn-close-admin-user-modal")?.addEventListener("click", closeAdminUserModal);
    $("btn-cancel-admin-user")?.addEventListener("click", closeAdminUserModal);
    $("admin-user-modal")?.addEventListener("click", event => { if (event.target === $("admin-user-modal")) closeAdminUserModal(); });
    $("btn-save-admin-user")?.addEventListener("click", saveAdminUser);

    $("admin-theme-file")?.addEventListener("change", previewSelectedThemeFile);
    $("admin-theme-overlay")?.addEventListener("input", event => {
      const percent = Number(event.target.value);
      setText("admin-overlay-value", `${percent}%`);
      document.documentElement.style.setProperty("--admin-interface-overlay", String(percent / 100));
    });
    $("btn-admin-theme-upload")?.addEventListener("click", uploadAdminTheme);
    $("btn-admin-theme-remove")?.addEventListener("click", removeAdminTheme);

    populateSystemBannerSelect();
    $("admin-banner-select")?.addEventListener("change", event => {
      adminState.selectedBannerId = event.target.value;
      cleanupSystemBannerPreview();
      if ($("admin-banner-file")) $("admin-banner-file").value = "";
      syncSystemBannerControls();
      setSystemBannerNote(`Đang chỉnh banner “${bannerDefinition().label}”.`);
    });
    $("admin-banner-file")?.addEventListener("change", previewSelectedSystemBannerFile);
    ["admin-banner-icon", "admin-banner-eyebrow", "admin-banner-title", "admin-banner-description"].forEach(id => $(id)?.addEventListener("input", renderSystemBannerPreview));
    $("admin-banner-position")?.addEventListener("change", renderSystemBannerPreview);
    $("admin-banner-overlay")?.addEventListener("input", renderSystemBannerPreview);
    $("admin-banner-enabled")?.addEventListener("change", renderSystemBannerPreview);
    $("btn-admin-banner-save")?.addEventListener("click", saveSystemBannerContent);
    $("btn-admin-banner-upload")?.addEventListener("click", uploadSystemBannerImage);
    $("btn-admin-banner-reset")?.addEventListener("click", resetSystemBanner);

    $("admin-dashboard-hero-file")?.addEventListener("change", previewSelectedDashboardFile);
    $("admin-dashboard-title-template")?.addEventListener("input", event => {
      setText("admin-dashboard-preview-title", dashboardGreetingPreview(event.target.value));
    });
    $("admin-dashboard-subtitle")?.addEventListener("input", event => {
      setText("admin-dashboard-preview-subtitle", event.target.value.trim() || "Tiến độ học tập, lịch sắp tới và kết quả mới nhất đã sẵn sàng.");
    });
    $("admin-dashboard-position")?.addEventListener("change", event => {
      const preview = $("admin-dashboard-hero-preview");
      if (preview) preview.style.backgroundPosition = dashboardHeroPositionValue(event.target.value);
    });
    $("admin-dashboard-overlay")?.addEventListener("input", event => {
      const percent = Number(event.target.value);
      setText("admin-dashboard-overlay-value", `${percent}%`);
      document.documentElement.style.setProperty("--dashboard-hero-overlay", String(percent / 100));
      const preview = $("admin-dashboard-hero-preview");
      const image = adminState.dashboardHeroPreviewUrl || adminState.dashboardHeroConfig?.imageUrl || "uneti-dashboard-hero.webp";
      if (preview) {
        preview.style.backgroundImage =
          `linear-gradient(90deg, rgba(3,17,29,${Math.min(.96, percent / 100 + .34)}), rgba(3,17,29,${Math.max(.12, percent / 100 - .08)})), url("${image}")`;
      }
    });
    $("btn-admin-dashboard-save")?.addEventListener("click", saveDashboardHeroContent);
    $("btn-admin-dashboard-upload")?.addEventListener("click", uploadDashboardHeroImage);
    $("btn-admin-dashboard-reset")?.addEventListener("click", resetDashboardHero);

    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !$("admin-user-modal")?.classList.contains("hidden")) closeAdminUserModal();
    });

    document.addEventListener("examflow:page-change", event => {
      if (event.detail?.pageId === "page-admin") loadAdminData(false);
    });
    document.addEventListener("examflow:workspace-opened", event => {
      if (event.detail?.role === "admin") {
        startInterfaceConfigListener();
        setTimeout(() => loadAdminData(false), 0);
      }
    });
  }

  function waitForAdminWorkspace(attempt = 0) {
    if (!auth.currentUser) return;
    if (core()?.currentRole === "admin") {
      loadAdminData(false);
      return;
    }
    if (attempt < 35) setTimeout(() => waitForAdminWorkspace(attempt + 1), 200);
  }

  const cachedConfig = readCachedInterfaceConfig();
  if (cachedConfig) applyInterfaceConfig(cachedConfig);
  const cachedDashboardHero = readCachedDashboardHeroConfig();
  applyDashboardHeroConfig(cachedDashboardHero || {});
  applyAllSystemBannerConfigs(readCachedSystemBanners());
  attachAdminEvents();
  startInterfaceConfigListener();
  startDashboardHeroConfigListener();
  startSystemBannerConfigListener();
  switchAdminView("overview");

  onAuthStateChanged(auth, user => {
    if (user) {
      startInterfaceConfigListener();
      startDashboardHeroConfigListener();
      startSystemBannerConfigListener();
      waitForAdminWorkspace();
    } else {
      adminState.users = [];
      adminState.courses = [];
      adminState.enrollments = [];
      adminState.exams = [];
      adminState.submissions = [];
      adminState.quizzes = [];
      adminState.quizAttempts = [];
      adminState.loadedAt = 0;
      adminState.selectedUser = null;
      closeAdminUserModal();
    }
  });

  window.ExamFlowAdmin = Object.freeze({
    loadAll: loadAdminData,
    loadUsers: () => loadAdminData(true),
    applyInterfaceConfig,
    applyDashboardHeroConfig,
    applySystemBannerConfig,
    switchView: switchAdminView,
    getState: () => ({
      activeView: adminState.activeView,
      userCount: adminState.users.length,
      courseCount: adminState.courses.length,
      examCount: adminState.exams.length,
      submissionCount: adminState.submissions.length,
      scoreCount: allScoreRecords().length,
      errors: [...adminState.errors.keys()]
    })
  });

  window.dispatchEvent(new CustomEvent("examflow:admin-ready"));
})();

