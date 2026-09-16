import { useEffect } from "react";
import { AppNav, embedded, reportLocation } from "@clawnify/app/client";
import { Notice } from "./notice";
import { AccountsPage } from "./pages/accounts";
import { HomePage } from "./pages/home";
import { InvoiceEditorPage } from "./pages/invoice-editor";
import { InvoicesPage } from "./pages/invoices";
import { JournalsPage } from "./pages/journals";
import { PartiesPage } from "./pages/parties";
import { ProductsPage } from "./pages/products";
import { ReportsPage } from "./pages/reports";
import { SettingsPage } from "./pages/settings";
import { Link, navigate, usePath } from "./router";

const NAV: { to: string; label: string }[] = [
  { to: "/invoices", label: "Invoices" },
  { to: "/customers", label: "Customers" },
  { to: "/suppliers", label: "Suppliers" },
  { to: "/products", label: "Products" },
  { to: "/journals", label: "Journal" },
  { to: "/reports", label: "Reports" },
  { to: "/accounts", label: "Accounts" },
];

// Embedded in the Clawnify workspace, the dashboard sidebar draws these and the
// in-page header is hidden. Standalone keeps the header below.
const HOST_NAV = [
  { items: [
    { id: "home", label: "Home", icon: "home", href: "/", home: true },
    { id: "invoices", label: "Invoices", icon: "file-text", href: "/invoices", color: "blue" as const },
    { id: "customers", label: "Customers", icon: "users", href: "/customers", color: "green" as const },
    { id: "suppliers", label: "Suppliers", icon: "truck", href: "/suppliers", color: "orange" as const },
    { id: "products", label: "Products", icon: "package", href: "/products", color: "violet" as const },
    { id: "journals", label: "Journal", icon: "book-open", href: "/journals", color: "sky" as const },
    { id: "reports", label: "Reports", icon: "bar-chart-3", href: "/reports", color: "red" as const },
    { id: "accounts", label: "Accounts", icon: "list", href: "/accounts", color: "amber" as const },
  ] },
  { label: "Admin", items: [
    { id: "settings", label: "Settings", icon: "settings", href: "/settings", color: "pink" as const },
  ] },
];

function activeNavId(path: string): string {
  const section = path.split("/")[1] ?? "";
  return section === "" ? "home" : section;
}

export function App() {
  const path = usePath();

  useEffect(() => {
    reportLocation(path + window.location.search);
  }, [path]);

  return (
    <div className="max-w-3xl mx-auto px-4 pb-20">
      {embedded ? (
        <div className="pt-8">
          <AppNav title="Books" icon="book-open" groups={HOST_NAV} active={activeNavId(path)}
            onNavigate={(item) => item.href && navigate(item.href)} />
        </div>
      ) : (
      <header className="flex items-baseline gap-6 mt-8 mb-8 pb-4 border-b border-gray-100 flex-wrap">
        <Link to="/" className="text-xl font-semibold text-gray-900 hover:no-underline">
          open-books
        </Link>
        <nav className="flex gap-4 text-sm">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className="text-gray-500 hover:text-gray-900" activeClassName="!text-gray-900 font-medium">
              {n.label}
            </Link>
          ))}
        </nav>
        <Link to="/settings" className="ml-auto text-sm text-gray-500 hover:text-gray-900" activeClassName="!text-gray-900 font-medium">
          Settings
        </Link>
      </header>
      )}
      <Notice />
      <main>{renderRoute(path)}</main>
    </div>
  );
}

function renderRoute(path: string) {
  if (path === "/" || path === "") return <HomePage />;
  const invoiceMatch = path.match(/^\/invoices\/(\d+)$/);
  if (invoiceMatch) return <InvoiceEditorPage id={Number(invoiceMatch[1])} />;
  if (path.startsWith("/invoices")) return <InvoicesPage />;
  if (path.startsWith("/customers")) return <PartiesPage kind="customer" />;
  if (path.startsWith("/suppliers")) return <PartiesPage kind="supplier" />;
  if (path.startsWith("/products")) return <ProductsPage />;
  if (path.startsWith("/journals")) return <JournalsPage />;
  if (path.startsWith("/reports")) return <ReportsPage />;
  if (path.startsWith("/accounts")) return <AccountsPage />;
  if (path.startsWith("/settings")) return <SettingsPage />;
  return <NotFound path={path} />;
}

function NotFound({ path }: { path: string }) {
  return (
    <div className="text-center py-16">
      <p className="text-sm text-gray-500">No page at <span className="font-mono">{path}</span></p>
      <Link to="/" className="text-sm text-blue-600 hover:underline mt-2 inline-block">Back home</Link>
    </div>
  );
}
