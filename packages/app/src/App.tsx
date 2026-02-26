import { AppLayout } from "@/components/layout/AppLayout";
import Chat from "@/pages/Chat";
import Home from "@/pages/Home";
import Notes from "@/pages/Notes";
import Reader from "@/pages/Reader";
import Stats from "@/pages/Stats";
/**
 * App — React Router configuration
 */
import { BrowserRouter, Route, Routes } from "react-router";

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/reader/:bookId" element={<Reader />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/stats" element={<Stats />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}
