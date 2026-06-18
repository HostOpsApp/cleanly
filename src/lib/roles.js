/**
 * Central role helpers for CleanPay.
 *
 * Base44 owns User.role. Keep it as:
 *   "admin" or "user"
 *
 * CleanPay business permissions use User.business_role. Use:
 *   "owner_admin", "manager", "staff", or "cleaner"
 *
 * Do not store owner_admin/manager/cleaner in User.role.
 */

export const BASE44_ROLES = {
  ADMIN: 'admin',
  USER: 'user',
};

export const BUSINESS_ROLES = {
  OWNER_ADMIN: 'owner_admin',
  MANAGER: 'manager',
  STAFF: 'staff',
  CLEANER: 'cleaner',
};

// Backward-compatible constants used by older JSX files.
export const ROLES = {
  ADMIN: BASE44_ROLES.ADMIN,
  OWNER_ADMIN: BUSINESS_ROLES.OWNER_ADMIN,
  MANAGER: BUSINESS_ROLES.MANAGER,
  USER: BUSINESS_ROLES.STAFF,
  STAFF: BUSINESS_ROLES.STAFF,
  CLEANER: BUSINESS_ROLES.CLEANER,
};

export const APP_ROLES = BUSINESS_ROLES;

export const ROLE_LABELS = {
  [BASE44_ROLES.ADMIN]: 'System Admin',
  [BASE44_ROLES.USER]: 'Base44 User',
  [BUSINESS_ROLES.OWNER_ADMIN]: 'Owner-Admin',
  [BUSINESS_ROLES.MANAGER]: 'Manager',
  [BUSINESS_ROLES.STAFF]: 'Staff',
  [BUSINESS_ROLES.CLEANER]: 'Cleaner',
};

export function normalizeRole(rawRole) {
  if (!rawRole) return '';
  return String(rawRole)
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

export function readUserField(user, field) {
  return (
    user?.[field] ??
    user?.data?.[field] ??
    user?.data?.data?.[field] ??
    null
  );
}

export function getBase44Role(user) {
  const role = normalizeRole(readUserField(user, 'role'));
  return role === BASE44_ROLES.ADMIN ? BASE44_ROLES.ADMIN : BASE44_ROLES.USER;
}

/**
 * CleanPay business role.
 * Preferred field: business_role.
 * Fallbacks support older app_role or older records where app roles were stored in User.role.
 */
export function getBusinessRole(user) {
  const preferredRole =
    readUserField(user, 'business_role') ??
    readUserField(user, 'app_role');

  const role = normalizeRole(preferredRole);
  if (Object.values(BUSINESS_ROLES).includes(role)) return role;

  // Migration fallback only: older exports used User.role for CleanPay roles.
  const oldRole = normalizeRole(readUserField(user, 'role'));
  if (Object.values(BUSINESS_ROLES).includes(oldRole)) return oldRole;
  if (oldRole === 'user') return BUSINESS_ROLES.STAFF;

  return BUSINESS_ROLES.STAFF;
}

// Backward-compatible helper names used by older JSX.
export const getAppRole = getBusinessRole;
export const getUserRole = getBusinessRole;

export function getBusinessId(user) {
  return readUserField(user, 'business_id') || readUserField(user, 'businessId') || '';
}

export function getCleanerId(user) {
  return readUserField(user, 'cleaner_id') || readUserField(user, 'cleanerId') || '';
}

export function isSystemAdmin(user) {
  return getBase44Role(user) === BASE44_ROLES.ADMIN;
}

// Backward-compatible helper name used by older JSX.
export const isAdmin = isSystemAdmin;

export function isOwnerAdmin(user) {
  return getBusinessRole(user) === BUSINESS_ROLES.OWNER_ADMIN;
}

export function isManager(user) {
  return getBusinessRole(user) === BUSINESS_ROLES.MANAGER;
}

export function isStaff(user) {
  return getBusinessRole(user) === BUSINESS_ROLES.STAFF;
}

export function isCleaner(user) {
  return getBusinessRole(user) === BUSINESS_ROLES.CLEANER;
}

export function canManageBusiness(user) {
  if (isSystemAdmin(user)) return true;
  return [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER].includes(getBusinessRole(user));
}

export const canAccessAdminPages = canManageBusiness;

export function canManageSettings(user) {
  if (isSystemAdmin(user)) return true;
  return getBusinessRole(user) === BUSINESS_ROLES.OWNER_ADMIN;
}

export function getRoleLabel(userOrRole) {
  const role = typeof userOrRole === 'string'
    ? normalizeRole(userOrRole)
    : isSystemAdmin(userOrRole)
      ? BASE44_ROLES.ADMIN
      : getBusinessRole(userOrRole);

  return ROLE_LABELS[role] || role || 'Staff';
}

export function requireBusinessId(user) {
  const business_id = getBusinessId(user);
  if (!business_id && !isSystemAdmin(user)) {
    throw new Error('Your user profile is missing business_id. Add business_id to the User record.');
  }
  return business_id;
}

export function businessFilter(user, extra = {}) {
  if (isSystemAdmin(user)) return extra;
  return { ...extra, business_id: requireBusinessId(user) };
}

export function withBusinessId(user, data = {}) {
  if (isSystemAdmin(user) && data.business_id) return data;
  return { ...data, business_id: requireBusinessId(user) };
}

export const PAGE_PERMISSIONS = {
  '/': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER, BUSINESS_ROLES.STAFF],
  '/pay-cleaner': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER],
  '/imports': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER],
  '/cleaners': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER],
  '/listings': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER],
  '/reservations': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER, BUSINESS_ROLES.STAFF],
  '/tasks': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER, BUSINESS_ROLES.STAFF, BUSINESS_ROLES.CLEANER],
  '/qbo-revenue': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER],
  '/matching': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER],
  '/exceptions': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER],
  '/payouts': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER],
  '/export': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER],
  '/reports': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER],
  '/settings': [BUSINESS_ROLES.OWNER_ADMIN],
  '/admin-audit': [BUSINESS_ROLES.OWNER_ADMIN],
  '/super-admin': [],
  '/hostaway-settings': [BUSINESS_ROLES.OWNER_ADMIN],
  '/qbo-import': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER],
  '/unauthorized': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER, BUSINESS_ROLES.STAFF, BUSINESS_ROLES.CLEANER],
  '/my-tasks': [BUSINESS_ROLES.OWNER_ADMIN, BUSINESS_ROLES.MANAGER, BUSINESS_ROLES.STAFF, BUSINESS_ROLES.CLEANER],
};

export function canAccessPage(user, path = '/') {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;

  const normalizedPath = (path || '/').split('?')[0].replace(/\/$/, '') || '/';
  const allowed = PAGE_PERMISSIONS[normalizedPath];
  if (!allowed) return false;
  return allowed.includes(getBusinessRole(user));
}

export const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', roles: PAGE_PERMISSIONS['/'], section: 'main' },
  { label: 'Pay Cleaner', path: '/pay-cleaner', roles: PAGE_PERMISSIONS['/pay-cleaner'], section: 'main' },
  { label: 'Import Batches', path: '/imports', roles: PAGE_PERMISSIONS['/imports'], section: 'data' },
  { label: 'Cleaners', path: '/cleaners', roles: PAGE_PERMISSIONS['/cleaners'], section: 'data' },
  { label: 'Listings', path: '/listings', roles: PAGE_PERMISSIONS['/listings'], section: 'data' },
  { label: 'Reservations', path: '/reservations', roles: PAGE_PERMISSIONS['/reservations'], section: 'data' },
  { label: 'Cleaning Tasks', path: '/tasks', roles: PAGE_PERMISSIONS['/tasks'], section: 'data' },
  { label: 'QBO Revenue', path: '/qbo-revenue', roles: PAGE_PERMISSIONS['/qbo-revenue'], section: 'data' },
  { label: 'Matching', path: '/matching', roles: PAGE_PERMISSIONS['/matching'], section: 'ops' },
  { label: 'Exceptions', path: '/exceptions', roles: PAGE_PERMISSIONS['/exceptions'], section: 'ops' },
  { label: 'Payout Runs', path: '/payouts', roles: PAGE_PERMISSIONS['/payouts'], section: 'ops' },
  { label: 'Export Bills', path: '/export', roles: PAGE_PERMISSIONS['/export'], section: 'ops' },
  { label: 'Reports', path: '/reports', roles: PAGE_PERMISSIONS['/reports'], section: 'reports' },
  { label: 'QBO Import', path: '/qbo-import', roles: PAGE_PERMISSIONS['/qbo-import'], section: 'integrations' },
  { label: 'Hostaway API', path: '/hostaway-settings', roles: PAGE_PERMISSIONS['/hostaway-settings'], section: 'integrations' },
  { label: 'Settings', path: '/settings', roles: PAGE_PERMISSIONS['/settings'], section: 'admin' },
  { label: 'Audit Log', path: '/admin-audit', roles: PAGE_PERMISSIONS['/admin-audit'], section: 'admin' },
  { label: 'Super Admin', path: '/super-admin', roles: PAGE_PERMISSIONS['/super-admin'], section: 'admin', systemAdminOnly: true },
];