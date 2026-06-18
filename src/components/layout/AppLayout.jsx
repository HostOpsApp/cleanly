import { useState, createContext, useContext } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const SidebarContext = createContext({ collapsed: false, setCollapsed: () => {} });
export const useSidebar = () => useContext(SidebarContext);

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      <div className="min-h-screen bg-background">
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
        <main className={`min-h-screen transition-all duration-300 ${collapsed ? 'ml-16' : 'ml-60'}`}>
          <div className="p-6 max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
    </SidebarContext.Provider>
  );
}