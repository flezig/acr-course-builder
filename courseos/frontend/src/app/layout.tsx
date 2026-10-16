import { useEffect, useRef, useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  Plus,
  LayoutList,
  Network,
  Files,
  ShieldCheck,
  GitCompareArrows,
  ChevronDown,
  Menu,
  X,
  FlaskConical,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
  Settings,
  LogIn,
} from 'lucide-react';
import { useApi, useCourse, useCourses } from '../entities/course/api/provider';
import { UnsavedProvider } from '../shared/lib/use-unsaved';
import { Badge } from '../shared/ui/ui';
import { DismissibleDetails } from '../shared/ui/dismissible-details';
import { SignInDialog } from '../features/methodist-sign-in/sign-in-dialog';
import { SettingsDialog } from '../features/workspace-settings/settings-dialog';
import { AiPageEdit } from '../features/ai-page-edit/ai-page-edit';
import courseosLogo from '../shared/assets/courseos-logo.png';
export function Layout() {
  return (
    <UnsavedProvider>
      <LayoutContent />
    </UnsavedProvider>
  );
}
function LayoutContent() {
  const { api } = useApi();
  const courses = useCourses();
  const course = useCourse();
  const { courseId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const previous = useRef('');
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('courseos-sidebar-collapsed') === 'true',
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#111827' : '#ffffff');
    try {
      localStorage.setItem('courseos-theme', theme);
    } catch {
      // The theme still works when browser storage is unavailable.
    }
  }, [theme]);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = sidebarRef.current;
    const focusable = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button, summary') || []).filter(
        (element) => element.getClientRects().length > 0,
      );
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
      }
      if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', handleKey);
      menuRef.current?.focus();
    };
  }, [menuOpen]);
  const snapshot = course.data?.snapshot;
  const archivedVersions =
    course.data?.versions.filter((version) => version !== course.data?.latest_version) ?? [];
  const versionSuffix = search.get('version') ? `?version=${search.get('version')}` : '';
  useEffect(() => {
    const positionKey = `courseos-scroll-${location.pathname}${location.search}`;
    const save = () => sessionStorage.setItem(positionKey, String(window.scrollY));
    const frame = requestAnimationFrame(() => {
      if (location.hash) {
        const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (target) {
          const details = target.closest('details');
          if (details) details.open = true;
          const isPlanSection = ['intent', 'curriculum', 'calendar', 'review'].includes(target.id);
          const isAuditSection = target.id === 'audit-checklist';
          if (
            (isPlanSection && location.pathname.endsWith('/plan')) ||
            (isAuditSection && location.pathname.endsWith('/audit'))
          ) {
            window.scrollTo(0, 0);
            return;
          }
          const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          target.scrollIntoView({
            block: isPlanSection ? 'start' : 'center',
            behavior: isPlanSection && !reducedMotion ? 'smooth' : 'instant',
          });
          target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
        }
      } else if (previous.current !== `${location.pathname}${location.search}`) {
        window.scrollTo(0, Number(sessionStorage.getItem(positionKey) || 0));
      }
      previous.current = `${location.pathname}${location.search}`;
    });
    window.addEventListener('scroll', save);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', save);
    };
  }, [location, snapshot?.course_version]);
  const currentTitle =
    courses.data?.find((item) => item.course_id === courseId)?.title ||
    course.data?.requirements.title;
  return (
    <div
      className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}${location.pathname.endsWith('/plan') ? ' plan-shell' : ''}`}
    >
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      {menuOpen && (
        <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}
      <aside
        ref={sidebarRef}
        id="course-navigation"
        className={`sidebar ${menuOpen ? 'is-open' : ''}`}
        role={menuOpen ? 'dialog' : undefined}
        aria-modal={menuOpen || undefined}
        aria-label="Навигация CourseOS"
      >
        <button
          className="sidebar-close"
          onClick={() => setMenuOpen(false)}
          aria-label="Закрыть навигацию"
        >
          <X size={20} />
        </button>
        <button
          className="sidebar-collapse"
          aria-label={collapsed ? 'Развернуть навигацию' : 'Свернуть навигацию'}
          aria-expanded={!collapsed}
          onClick={() => {
            setCollapsed(!collapsed);
            localStorage.setItem('courseos-sidebar-collapsed', String(!collapsed));
          }}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <Link to="/" className="brand" aria-label="CourseOS — на главную">
          <svg className="brand-logo" viewBox="185 288 1406 326" role="img" aria-label="CourseOS">
            <image href={courseosLogo} width="1774" height="887" />
          </svg>
        </Link>
        <NavLink to="/" className="new-course">
          <Plus size={18} />
          <span>Создать программу</span>
        </NavLink>
        <div className="program-section">
          <div className="sidebar-label">Текущая программа</div>
          <DismissibleDetails
            className="program-switcher"
            key={courseId || 'new'}
            dismissKey={location.key}
          >
            <summary className="program-trigger" aria-label="Выбрать программу">
              <span title={courses.data?.find((item) => item.course_id === courseId)?.title}>
                {courses.data?.find((item) => item.course_id === courseId)?.title ||
                  'Выберите программу'}
              </span>
              <ChevronDown size={16} className="switcher-chevron" />
            </summary>
            <div className="program-options">
              {courses.data?.length ? (
                courses.data.map((item) => (
                  <button
                    key={item.course_id}
                    aria-current={item.course_id === courseId ? 'true' : undefined}
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open');
                      navigate(`/courses/${item.course_id}/plan`);
                    }}
                  >
                    {item.title}
                  </button>
                ))
              ) : (
                <p>Пока нет программ</p>
              )}
            </div>
          </DismissibleDetails>
        </div>
        <nav aria-label="Экраны программы">
          {[
            { path: 'plan', title: 'Программа и учебный план', Icon: LayoutList },
            { path: 'map', title: 'Карта результатов', Icon: Network },
            { path: 'audit', title: 'Проверка программы', Icon: ShieldCheck },
            { path: 'materials', title: 'Материалы и выгрузки', Icon: Files },
            { path: 'compare', title: 'Сравнение версий', Icon: GitCompareArrows },
          ].map(({ path, title, Icon }) =>
            courseId ? (
              <NavLink
                key={path}
                title={title}
                aria-label={title}
                to={`/courses/${courseId}/${path}${versionSuffix}`}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={20} strokeWidth={1.75} />
                <span>{title}</span>
              </NavLink>
            ) : (
              <span className="nav-item disabled" key={path}>
                <Icon size={20} strokeWidth={1.75} />
                <span>{title}</span>
              </span>
            ),
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <FlaskConical size={18} />
            {api.mode === 'live' && <strong>Реальный API</strong>}
            <p>
              {api.mode === 'demo'
                ? 'Данные и задачи сохраняются в этом браузере. Генерация моделируется.'
                : 'Данные приходят с настроенного backend. При сбое demo не подставляется.'}
            </p>
          </div>
          <DismissibleDetails className="profile-menu" dismissKey={location.key}>
            <summary className="user-profile" aria-label="Меню методиста">
              <span>М</span>
              <div>
                <strong>Методист</strong>
                <small>Настройки и вход</small>
              </div>
              <ChevronDown size={16} className="switcher-chevron" />
            </summary>
            <div className="profile-options">
              <button
                aria-haspopup="dialog"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  setSettingsOpen(true);
                }}
              >
                <Settings size={16} />
                Настройки
              </button>
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              </button>
              <button
                aria-haspopup="dialog"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  setSignInOpen(true);
                }}
              >
                <LogIn size={16} />
                Войти в аккаунт
              </button>
            </div>
          </DismissibleDetails>
          <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
          <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            ref={menuRef}
            className="mobile-menu"
            aria-label="Открыть навигацию"
            aria-expanded={menuOpen}
            aria-controls="course-navigation"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={20} />
            <span>CourseOS</span>
          </button>
          <span className="breadcrumb">
            Программы <span>/</span> {courseId ? currentTitle || 'Программа' : 'Новая программа'}
          </span>
          <div className="topbar-actions">
            <Badge tone={api.mode === 'demo' ? 'amber' : 'green'}>
              {api.mode === 'demo' ? 'Демо-режим' : 'LIVE · Данные сервера'}
            </Badge>
          </div>
          {/* Переключатель нужен, только когда есть прошлые версии: с одной версией
              он предлагал выбрать её же как «актуальную» и как «архив». */}
          {courseId &&
            !location.pathname.endsWith('/compare') &&
            (archivedVersions.length > 0 || snapshot?.provenance === 'previous_live') && (
              <div className="versionbar">
                <div>
                  {archivedVersions.length > 0 && (
                    <label>
                      Версия{' '}
                      <select
                        aria-label="Версия курса"
                        value={search.get('version') || 'latest'}
                        onChange={(e) => {
                          const next = new URLSearchParams(search);
                          e.target.value === 'latest'
                            ? next.delete('version')
                            : next.set('version', e.target.value);
                          navigate(`${location.pathname}?${next}`);
                        }}
                      >
                        <option value="latest">Актуальная {course.data?.latest_version}</option>
                        {archivedVersions.map((version) => (
                          <option key={version} value={version}>
                            Архив v{version}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {snapshot?.provenance === 'previous_live' && (
                    <Badge>Ранее полученный реальный результат</Badge>
                  )}
                </div>
              </div>
            )}
        </header>
        <main id="main" tabIndex={-1}>
          <Outlet key={api.mode} />
        </main>
        <AiPageEdit />
      </div>
    </div>
  );
}
