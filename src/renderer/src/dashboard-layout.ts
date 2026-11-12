export const DASHBOARD_LAYOUT_STORAGE_KEY = 'lifeassist-dashboard-layout-v1';

export const DASHBOARD_WIDGET_IDS = [
  'today-summary',
  'agenda',
  'focus',
  'goals',
  'projects',
  'weekly-completions',
  'routines',
  'pinned-notes',
  'upcoming',
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

export type DashboardLayout = {
  version: 1;
  order: DashboardWidgetId[];
  hidden: DashboardWidgetId[];
};

type DashboardStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DEFAULT_LAYOUT: DashboardLayout = {
  version: 1,
  order: [...DASHBOARD_WIDGET_IDS],
  hidden: [],
};

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseDashboardLayout(value: unknown): DashboardLayout {
  if (!isRecord(value) || value.version !== 1) {
    return { ...DEFAULT_LAYOUT, order: [...DEFAULT_LAYOUT.order], hidden: [] };
  }

  const seen = new Set<DashboardWidgetId>();
  const requestedOrder = Array.isArray(value.order) ? value.order : [];
  const order = requestedOrder.filter((id): id is DashboardWidgetId => {
    if (!isDashboardWidgetId(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!seen.has(id)) order.push(id);
  }

  const orderedWithoutSummary = order.filter((id) => id !== 'today-summary');
  const normalizedOrder: DashboardWidgetId[] = ['today-summary', ...orderedWithoutSummary];
  const hiddenSeen = new Set<DashboardWidgetId>();
  const hidden = (Array.isArray(value.hidden) ? value.hidden : []).filter((id): id is DashboardWidgetId => {
    if (!isDashboardWidgetId(id) || id === 'today-summary' || hiddenSeen.has(id)) return false;
    hiddenSeen.add(id);
    return true;
  });

  return { version: 1, order: normalizedOrder, hidden };
}

export function visibleDashboardWidgets(layout: DashboardLayout): DashboardWidgetId[] {
  const normalized = parseDashboardLayout(layout);
  const hidden = new Set(normalized.hidden);
  return normalized.order.filter((id) => !hidden.has(id));
}

export function moveDashboardWidget(
  layout: DashboardLayout,
  id: DashboardWidgetId,
  direction: -1 | 1,
): DashboardLayout {
  const normalized = parseDashboardLayout(layout);
  if (id === 'today-summary') return normalized;

  const index = normalized.order.indexOf(id);
  const nextIndex = index + direction;
  if (index < 1 || nextIndex < 1 || nextIndex >= normalized.order.length) return normalized;

  const order = [...normalized.order];
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  return { ...normalized, order };
}

export function setDashboardWidgetVisibility(
  layout: DashboardLayout,
  id: DashboardWidgetId,
  visible: boolean,
): DashboardLayout {
  const normalized = parseDashboardLayout(layout);
  if (id === 'today-summary') return normalized;

  const hidden = new Set(normalized.hidden);
  if (visible) hidden.delete(id);
  else hidden.add(id);
  return { ...normalized, hidden: normalized.order.filter((widgetId) => hidden.has(widgetId)) };
}

export function readDashboardLayout(storage: DashboardStorage): DashboardLayout {
  try {
    const serialized = storage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
    if (serialized === null) return parseDashboardLayout(null);
    return parseDashboardLayout(JSON.parse(serialized) as unknown);
  } catch {
    return parseDashboardLayout(null);
  }
}

export function writeDashboardLayout(layout: DashboardLayout, storage: DashboardStorage): boolean {
  try {
    storage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(parseDashboardLayout(layout)));
    return true;
  } catch {
    return false;
  }
}
