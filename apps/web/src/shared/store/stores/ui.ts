import { createStore } from 'zustand';

export type Theme = 'dark' | 'light';

export interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
}

export interface UIActions {
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export type UIStore = UIState & UIActions;

export const defaultUIState: UIState = {
  theme: 'dark',
  sidebarOpen: false,
};

export const createUIStore = (initState: UIState = defaultUIState) => {
  return createStore<UIStore>()((set) => ({
    ...initState,
    setTheme: (theme) => set({ theme }),
    toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  }));
};
