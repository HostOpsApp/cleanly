import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Upload, Users, Home, CalendarCheck,
  ClipboardList, TrendingUp, GitCompare, AlertTriangle,
  CreditCard, Download, BarChart3, Settings, ChevronLeft, ChevronRight,
  DollarSign, ShieldAlert, Webhook, BookOpen, ListChecks, LogOut
} from 'lucide-react';
import React from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { NAV_ITEMS, canAccessPage, getRoleLabel, getBusinessName } from '@/lib/roles';


const ICONS = {
  '/':                  LayoutDashboard,
  '/pay-cleaner':       ListChecks,
  '/imports':           Upload,
  '/cleaners':          Users,
  '/listings':          Home,
  '/reservations':      CalendarCheck,
  '/tasks':             ClipboardList,
  '/qbo-revenue':       TrendingUp,
  '/matching':          GitCompare,
  '/exceptions':        AlertTriangle,
  '/payouts':           CreditCard,
  '/export':            Download,
  '/reports':           BarChart3,
  '/qbo-import':        BookOpen,
  '/hostaway-settings': Webhook,
  '/settings':          Settings,
  '/admin-audit':       ShieldAlert,
};


export default function Sidebar({ collapsed, setCollapsed }) {
  const location = useLocation();
  const { user, logout } = useAuth();

  const businessName = getBusinessName(user) || 'Payout Automation';
  const visibleItems = NAV_ITEMS.filter(item => canAccessPage(user, item.path));

  return (
    <aside className={cn(
      "fixed left-0 top-0 h-screen bg-sidebar text-sidebar-foreground flex flex-col z-40 transition-all duration-300 border-r border-sidebar-border",
      collapsed ? "w-16" : "w-60"
    )}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border flex-shrink-0">
        {!collapsed ? (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white">CleanPay</h1>
              <p className="text-[10px] text-sidebar-foreground/60 truncate max-w-[150px]">
                {businessName}
              </p>
            </div>
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center mx-auto">
            <DollarSign className="w-4 h-4 text-primary-foreground" />
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 scrollbar-thin">
        {visibleItems.map((item) => {
          const Icon = ICONS[item.path] || LayoutDashboard;
          const isActive = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 mb-0.5",
                isActive
                  ? "bg-sidebar-accent text-white"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User info + logout */}
      {!collapsed && user && (
        <div className="px-3 py-3 border-t border-sidebar-border">
          <div className="text-[11px] text-sidebar-foreground/50 truncate">{user.email}</div>
          <div className="text-[10px] text-sidebar-foreground/40 mt-0.5">
            {getRoleLabel(user)}
          </div>
          <button
            onClick={() => logout()}
            className="mt-2 flex items-center gap-1.5 text-[11px] text-sidebar-foreground/50 hover:text-white transition-colors"
          >
            <LogOut className="w-3 h-3" /> Sign out
          </button>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center h-10 border-t border-sidebar-border text-sidebar-foreground/50 hover:text-white transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  );
}