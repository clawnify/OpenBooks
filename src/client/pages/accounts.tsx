import { useEffect, useState } from "react";
import { ConfirmButton } from "../notice";
import { refused } from "../refusal";

interface AccountNode {
  rgs_code: string;
  reknr: string | null;
  parent_code: string | null;
  nivo: number;
  omskort: string;
  omslang: string | null;
  dc: "D" | "C" | null;
  bw: "B" | "W";
  is_leaf: number;
  children: AccountNode[];
}

export function AccountsPage() {
  const [tree, setTree] = useState<AccountNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  async function load() {
    const res = await fetch("/api/accounts/tree");
    const data: AccountNode[] = await res.json();
    setTree(data);
    setCount(countAll(data));
  }

  useEffect(() => { load(); }, []);

  async function seed() {
    setLoading(true);
    await fetch("/api/accounts/seed", { method: "POST" });
    await load();
    setLoading(false);
  }

  async function clearAll() {
    setLoading(true);
    await refused(await fetch("/api/accounts", { method: "DELETE" }));
    await load();
    setLoading(false);
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Chart of Accounts</h2>
      <p className="text-sm text-gray-500 mb-6">RGS &middot; Referentie Grootboekschema</p>

      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={seed}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {count === 0 ? "Load starter chart" : "Reload starter chart"}
        </button>
        {count !== null && count > 0 && (
          <ConfirmButton
            prompt="Clear all accounts?"
            confirmLabel="Clear"
            onConfirm={clearAll}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Clear
          </ConfirmButton>
        )}
        {count !== null && (
          <span className="text-xs text-gray-400 ml-auto">{count} accounts</span>
        )}
      </div>

      {tree.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
          <p className="text-sm text-gray-500 mb-1">No accounts loaded.</p>
          <p className="text-xs text-gray-400">
            Click <span className="font-medium">Load starter chart</span> to seed the top-level RGS rubrieken.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {tree.map((root) => (
            <AccountRow key={root.rgs_code} node={root} depth={0} />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-8">
        Starter dataset includes top-level rubrieken (B/W) and principal level-2 groepen only.
        Replace with the canonical ~4000-row RGS export from SBR Nederland for production use.
      </p>
    </div>
  );
}

function AccountRow({ node, depth }: { node: AccountNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const tone = node.bw === "B" ? "text-blue-600" : "text-emerald-600";
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-50 cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => hasChildren && setOpen(!open)}
      >
        <span className="w-4 text-gray-400 text-xs">
          {hasChildren ? (open ? "▾" : "▸") : ""}
        </span>
        <span className={`font-mono text-xs ${tone} w-20`}>{node.rgs_code}</span>
        <span className="text-sm text-gray-800 flex-1">{node.omskort}</span>
        {node.dc && <span className="text-xs text-gray-400 font-mono">{node.dc}</span>}
        {node.reknr && <span className="text-xs text-gray-400 font-mono">{node.reknr}</span>}
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <AccountRow key={child.rgs_code} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function countAll(tree: AccountNode[]): number {
  let n = 0;
  for (const node of tree) n += 1 + countAll(node.children);
  return n;
}
