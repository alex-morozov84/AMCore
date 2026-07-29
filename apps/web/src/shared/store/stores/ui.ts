import { createStore } from 'zustand'

export interface UIState {
  sidebarOpen: boolean
}

export interface UIActions {
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
}

export type UIStore = UIState & UIActions

export const defaultUIState: UIState = {
  sidebarOpen: false,
}

export const createUIStore = (initState: UIState = defaultUIState) => {
  return createStore<UIStore>()((set) => ({
    ...initState,
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  }))
}
