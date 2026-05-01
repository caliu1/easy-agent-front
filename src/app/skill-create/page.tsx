"use client";

import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { agentService } from "@/api/agent";
import { cookieUtils } from "@/utils/cookie";
import type {
  AgentSkillAssetsEntryDTO,
  AgentSkillImportItemDTO,
  AgentSkillProfileResponseDTO,
} from "@/types/api";

const SUCCESS_CODE = "0000";
const FIXED_SKILL_PREFIX = "easyagent/skills/";

type SkillAssetItem = {
  id: string;
  kind: "file" | "folder";
  path: string;
  content: string;
};

type TreeNode = {
  key: string;
  kind: "file" | "folder";
  name: string;
  path: string;
  assetId?: string;
  children: TreeNode[];
};

const DEFAULT_SKILL_MD = `---
name: my-skill
description: 技能描述
---

# Skill

在这里编写技能说明。`;

const createAssetId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createDefaultAssets = (): SkillAssetItem[] => [
  {
    id: createAssetId(),
    kind: "file",
    path: "SKILL.md",
    content: DEFAULT_SKILL_MD,
  },
];

const isRootSkillMarkdown = (asset: SkillAssetItem) =>
  asset.kind === "file" && asset.path === "SKILL.md";

const normalizeSkillName = (raw: string): string => {
  const normalized = raw
    .trim()
    .replace(/^easyagent\/skills\//, "")
    .replace(/\/+$/g, "");
  if (!normalized) throw new Error("请填写 SKILL 名称");
  if (normalized.includes("/") || normalized === "." || normalized === "..") {
    throw new Error("SKILL 名称必须是单层目录名");
  }
  return normalized;
};

const normalizeRelativePath = (rawPath: string, isFolder: boolean): string => {
  let normalized = rawPath.trim().replace(/\\/g, "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  while (normalized.startsWith("/")) normalized = normalized.slice(1);
  while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  if (!normalized) throw new Error("路径不能为空");

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error(`非法路径：${rawPath}`);
    }
  }

  if (isFolder && normalized.toUpperCase() === "SKILL.MD") {
    throw new Error("SKILL.md 必须是文件，不能是文件夹");
  }
  return segments.join("/");
};

const stripSkillPrefix = (value: string) => {
  if (value.startsWith(FIXED_SKILL_PREFIX)) return value.slice(FIXED_SKILL_PREFIX.length);
  if (value.startsWith("skills/")) {
    throw new Error("旧路径 skills/ 已废弃，请使用 easyagent/skills/{skillName}");
  }
  return value;
};

const extractRootFolder = (ossPath: string): string => {
  const raw = ossPath.trim().replace(/\\/g, "/");
  if (!raw) return "";

  if (raw.startsWith("oss://")) {
    const withoutScheme = raw.slice("oss://".length);
    const slashIndex = withoutScheme.indexOf("/");
    const keyPart = slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : "";
    return stripSkillPrefix(keyPart.replace(/^\/+|\/+$/g, "")).split("/")[0] ?? "";
  }

  return stripSkillPrefix(raw.replace(/^\/+|\/+$/g, "")).split("/")[0] ?? "";
};

const ensureRootSkillMd = (assets: SkillAssetItem[]): SkillAssetItem[] => {
  if (assets.some(isRootSkillMarkdown)) return assets;
  return [{ id: createAssetId(), kind: "file", path: "SKILL.md", content: DEFAULT_SKILL_MD }, ...assets];
};

const getParentFolderPath = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "" : path.slice(0, index);
};

const collectParentFolders = (path: string): string[] => {
  const parts = path.split("/").filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    current = current ? `${current}/${parts[i]}` : parts[i];
    result.push(current);
  }
  return result;
};

const sortAssets = (assets: SkillAssetItem[]) =>
  [...assets].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

const mapEntriesToAssets = (entries: AgentSkillAssetsEntryDTO[] | undefined): SkillAssetItem[] => {
  if (!entries || entries.length === 0) return createDefaultAssets();
  const assets: SkillAssetItem[] = [];
  for (const entry of entries) {
    if (!entry || (entry.kind !== "file" && entry.kind !== "folder")) continue;
    if (!entry.path || !entry.path.trim()) continue;
    assets.push({
      id: createAssetId(),
      kind: entry.kind,
      path: entry.path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
      content: entry.kind === "file" ? entry.content || "" : "",
    });
  }
  return ensureRootSkillMd(sortAssets(assets));
};

const collectInitialExpanded = (assets: SkillAssetItem[]): string[] => {
  const expanded = new Set<string>([""]);
  for (const asset of assets) {
    if (asset.kind === "folder") {
      const parts = asset.path.split("/");
      let current = "";
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        expanded.add(current);
      }
    } else {
      for (const parent of collectParentFolders(asset.path)) expanded.add(parent);
    }
  }
  return Array.from(expanded);
};

const buildTree = (assets: SkillAssetItem[]): TreeNode[] => {
  const folderPathSet = new Set<string>();
  const folderAssetMap = new Map<string, SkillAssetItem>();
  const fileAssets: SkillAssetItem[] = [];

  for (const asset of assets) {
    if (asset.kind === "folder") {
      folderPathSet.add(asset.path);
      folderAssetMap.set(asset.path, asset);
    } else {
      fileAssets.push(asset);
      for (const parent of collectParentFolders(asset.path)) folderPathSet.add(parent);
    }
  }

  const root: TreeNode = { key: "root", kind: "folder", name: "", path: "", children: [] };
  const folderNodeMap = new Map<string, TreeNode>([["", root]]);

  const folderPaths = Array.from(folderPathSet).sort((a, b) => {
    const depthDiff = a.split("/").length - b.split("/").length;
    if (depthDiff !== 0) return depthDiff;
    return a.localeCompare(b);
  });

  for (const folderPath of folderPaths) {
    const parts = folderPath.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const parent = folderNodeMap.get(parentPath) || root;
    const folderAsset = folderAssetMap.get(folderPath);

    const node: TreeNode = {
      key: `folder:${folderPath}`,
      kind: "folder",
      name,
      path: folderPath,
      assetId: folderAsset?.id,
      children: [],
    };
    folderNodeMap.set(folderPath, node);
    parent.children.push(node);
  }

  for (const file of [...fileAssets].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const parent = folderNodeMap.get(parentPath) || root;
    parent.children.push({
      key: `file:${file.path}:${file.id}`,
      kind: "file",
      name,
      path: file.path,
      assetId: file.id,
      children: [],
    });
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) if (node.children.length) sortNodes(node.children);
  };
  sortNodes(root.children);

  return root.children;
};

export default function SkillCreatePage() {
  const router = useRouter();
  const session = useMemo(() => cookieUtils.getSession(), []);
  const userId = session.username || "";
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importingZip, setImportingZip] = useState(false);

  const [skillName, setSkillName] = useState("");
  const [assets, setAssets] = useState<SkillAssetItem[]>(createDefaultAssets());
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedFolderPath, setSelectedFolderPath] = useState("");
  const [pathEditor, setPathEditor] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<string[]>([""]);

  const selectedAsset = assets.find((item) => item.id === selectedAssetId) || null;
  const treeNodes = useMemo(() => buildTree(assets), [assets]);

  useEffect(() => {
    if (session.isLoggedIn !== "true" || !session.username) {
      router.replace("/login");
      return;
    }

    if (typeof window === "undefined") return;
    const searchParams = new URLSearchParams(window.location.search);
    const idText = searchParams.get("id");
    const idNumber = Number(idText);
    if (Number.isInteger(idNumber) && idNumber > 0) {
      setEditingId(idNumber);
      return;
    }

    const initial = createDefaultAssets();
    setAssets(initial);
    setSelectedAssetId(initial[0].id);
    setSelectedFolderPath("");
    setPathEditor(initial[0].path);
    setExpandedFolders([""]);
  }, [router, session.isLoggedIn, session.username]);

  const loadAssetsFromOss = async (profile: AgentSkillProfileResponseDTO) => {
    if (!profile.ossPath) {
      const initial = createDefaultAssets();
      setAssets(initial);
      setSelectedAssetId(initial[0].id);
      setSelectedFolderPath("");
      setExpandedFolders([""]);
      return;
    }

    const response = await agentService.querySkillAssets(profile.ossPath);
    if (response.code !== SUCCESS_CODE || !response.data) {
      throw new Error(response.info || "加载 SKILL 目录失败");
    }

    const mapped = mapEntriesToAssets(response.data.entries);
    setAssets(mapped);
    const first = mapped[0] || null;
    setSelectedAssetId(first?.id || "");
    setSelectedFolderPath(first ? (first.kind === "folder" ? first.path : getParentFolderPath(first.path)) : "");
    setExpandedFolders(collectInitialExpanded(mapped));
  };

  useEffect(() => {
    if (!editingId || !userId) return;
    setLoadingProfile(true);
    void (async () => {
      try {
        const response = await agentService.querySkillProfileList(userId);
        if (response.code !== SUCCESS_CODE || !response.data) {
          throw new Error(response.info || "加载 SKILL 配置失败");
        }
        const profile = response.data.find((item) => item.id === editingId);
        if (!profile) throw new Error("未找到要编辑的 SKILL");

        setSkillName(profile.skillName || extractRootFolder(profile.ossPath || ""));
        await loadAssetsFromOss(profile);
      } catch (error) {
        console.error(error);
        window.alert(error instanceof Error ? error.message : "加载 SKILL 配置失败");
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, [editingId, userId]);

  useEffect(() => {
    if (!selectedAsset) {
      setSelectedFolderPath("");
      return;
    }
    setPathEditor(selectedAsset.path);
    setSelectedFolderPath(
      selectedAsset.kind === "folder" ? selectedAsset.path : getParentFolderPath(selectedAsset.path),
    );
  }, [selectedAsset?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSelectionByFallback = (nextAssets: SkillAssetItem[]) => {
    const fallback = nextAssets.find(isRootSkillMarkdown) || nextAssets[0] || null;
    setSelectedAssetId(fallback?.id || "");
    setSelectedFolderPath(
      fallback ? (fallback.kind === "folder" ? fallback.path : getParentFolderPath(fallback.path)) : "",
    );
  };

  const updateAssetContent = (assetId: string, content: string) => {
    setAssets((prev) => prev.map((item) => (item.id === assetId ? { ...item, content } : item)));
  };

  const applyPathUpdate = () => {
    if (!selectedAsset) return;
    try {
      const nextPath = normalizeRelativePath(pathEditor, selectedAsset.kind === "folder");
      if (nextPath === selectedAsset.path) return;

      const duplicate = assets.some(
        (item) => item.id !== selectedAsset.id && item.kind === selectedAsset.kind && item.path === nextPath,
      );
      if (duplicate) throw new Error("目标路径已存在");

      if (selectedAsset.kind === "folder") {
        const sourcePrefix = `${selectedAsset.path}/`;
        const targetPrefix = `${nextPath}/`;
        const nextAssets = assets.map((item) => {
          if (item.id === selectedAsset.id) return { ...item, path: nextPath };
          if (item.path.startsWith(sourcePrefix)) {
            return { ...item, path: `${targetPrefix}${item.path.slice(sourcePrefix.length)}` };
          }
          return item;
        });
        setAssets(sortAssets(nextAssets));
        setSelectedFolderPath(nextPath);
        setExpandedFolders((prev) =>
          prev.map((folderPath) =>
            folderPath === selectedAsset.path
              ? nextPath
              : folderPath.startsWith(sourcePrefix)
                ? `${targetPrefix}${folderPath.slice(sourcePrefix.length)}`
                : folderPath,
          ),
        );
        return;
      }

      setAssets((prev) =>
        sortAssets(prev.map((item) => (item.id === selectedAsset.id ? { ...item, path: nextPath } : item))),
      );
      setSelectedFolderPath(getParentFolderPath(nextPath));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "路径更新失败");
      setPathEditor(selectedAsset.path);
    }
  };

  const resolveCreateBaseFolder = (): string => {
    if (selectedAsset?.kind === "folder") return selectedAsset.path;
    if (selectedFolderPath) return selectedFolderPath;
    if (selectedAsset?.kind === "file") return getParentFolderPath(selectedAsset.path);
    return "";
  };

  const composeTargetPath = (base: string, rawInput: string, isFolder: boolean): string => {
    const relativePath = normalizeRelativePath(rawInput, isFolder);
    if (!base) return relativePath;
    if (relativePath.startsWith(`${base}/`) || relativePath === base) return relativePath;
    return `${base}/${relativePath}`;
  };

  const addFileByPath = (rawInput: string) => {
    try {
      const path = composeTargetPath(resolveCreateBaseFolder(), rawInput, false);
      if (assets.some((item) => item.kind === "file" && item.path === path)) {
        throw new Error("文件路径已存在");
      }
      const asset: SkillAssetItem = {
        id: createAssetId(),
        kind: "file",
        path,
        content: path === "SKILL.md" ? DEFAULT_SKILL_MD : "",
      };
      const next = sortAssets([...assets, asset]);
      setAssets(next);
      setSelectedAssetId(asset.id);
      setSelectedFolderPath(getParentFolderPath(path));
      setExpandedFolders((prev) => Array.from(new Set([...prev, ...collectParentFolders(path)])));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "新增文件失败");
    }
  };

  const addFolderByPath = (rawInput: string) => {
    try {
      const path = composeTargetPath(resolveCreateBaseFolder(), rawInput, true);
      if (assets.some((item) => item.kind === "folder" && item.path === path)) {
        throw new Error("目录路径已存在");
      }
      const asset: SkillAssetItem = {
        id: createAssetId(),
        kind: "folder",
        path,
        content: "",
      };
      const next = sortAssets([...assets, asset]);
      setAssets(next);
      setSelectedAssetId(asset.id);
      setSelectedFolderPath(path);
      setExpandedFolders((prev) => Array.from(new Set([...prev, path, ...collectParentFolders(path)])));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "新增目录失败");
    }
  };

  const quickAddFile = () => {
    const base = resolveCreateBaseFolder();
    const input = window.prompt(
      base ? `在 ${base}/ 下新增文件（输入相对路径）` : "新增文件（输入路径）",
      "new-file.md",
    );
    if (!input) return;
    addFileByPath(input);
  };

  const quickAddFolder = () => {
    const base = resolveCreateBaseFolder();
    const input = window.prompt(
      base ? `在 ${base}/ 下新增子文件夹（输入相对路径）` : "新增文件夹（输入路径）",
      "new-folder",
    );
    if (!input) return;
    addFolderByPath(input);
  };

  const deleteFolderByPath = (folderPath: string) => {
    if (!folderPath) return;
    if (!window.confirm(`确认删除文件夹 ${folderPath} 及其全部内容？`)) return;

    const next = assets.filter((item) => item.path !== folderPath && !item.path.startsWith(`${folderPath}/`));
    setAssets(next);
    setSelectionByFallback(next);
    setExpandedFolders((prev) => prev.filter((path) => path !== folderPath && !path.startsWith(`${folderPath}/`)));
  };

  const deleteAsset = (assetId: string) => {
    const target = assets.find((item) => item.id === assetId);
    if (!target) return;
    if (isRootSkillMarkdown(target)) {
      window.alert("根目录 SKILL.md 不能删除");
      return;
    }
    if (target.kind === "folder") {
      deleteFolderByPath(target.path);
      return;
    }

    const next = assets.filter((item) => item.id !== target.id);
    setAssets(next);
    setSelectionByFallback(next);
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => (prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]));
  };

  const validateBeforeSubmit = () => {
    if (!userId) throw new Error("用户未登录");
    const normalizedSkillName = normalizeSkillName(skillName);
    const dedup = new Set<string>();

    const normalizedAssets = assets.map((item) => {
      const path = normalizeRelativePath(item.path, item.kind === "folder");
      const key = `${item.kind}:${path}`;
      if (dedup.has(key)) throw new Error(`存在重复路径：${path}`);
      dedup.add(key);
      return { ...item, path, content: item.kind === "file" ? item.content : "" };
    });

    if (!normalizedAssets.some(isRootSkillMarkdown)) {
      throw new Error("根目录必须包含 SKILL.md");
    }
    return { normalizedSkillName, normalizedAssets };
  };

  const handleSubmit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { normalizedSkillName, normalizedAssets } = validateBeforeSubmit();
      const saveResponse = await agentService.saveSkillAssets({
        operator: userId,
        rootFolder: normalizedSkillName,
        entries: normalizedAssets.map((item) => ({
          kind: item.kind,
          path: item.path,
          content: item.kind === "file" ? item.content : "",
        })),
      });
      if (saveResponse.code !== SUCCESS_CODE || !saveResponse.data) {
        throw new Error(saveResponse.info || "保存 SKILL 到 OSS 失败");
      }

      const ossPath = saveResponse.data.prefix || `${FIXED_SKILL_PREFIX}${normalizedSkillName}`;
      const payload = {
        id: editingId ?? undefined,
        userId,
        skillName: normalizedSkillName,
        ossPath,
      };
      const profileResponse = editingId
        ? await agentService.updateSkillProfile(payload)
        : await agentService.createSkillProfile(payload);
      if (profileResponse.code !== SUCCESS_CODE) {
        throw new Error(profileResponse.info || "保存 SKILL 元信息失败");
      }

      window.alert(editingId ? "SKILL 已更新" : "SKILL 已创建");
      router.push("/");
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const renderTreeNode = (node: TreeNode, depth: number): ReactNode => {
    const isFolder = node.kind === "folder";
    const expanded = expandedFolders.includes(node.path);
    const nodeAsset = node.assetId ? assets.find((item) => item.id === node.assetId) : null;
    const selectedByAsset = Boolean(nodeAsset && selectedAssetId === nodeAsset.id);
    const selectedByFolderPath = isFolder && selectedFolderPath === node.path;
    const selected = selectedByAsset || selectedByFolderPath;

    return (
      <div key={node.key}>
        <div
          className={`mb-0.5 flex items-center gap-1 rounded-lg px-2 py-1 text-xs ${
            selected ? "bg-blue-50 text-blue-700" : "text-zinc-700 hover:bg-zinc-100"
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {isFolder ? (
            <button
              type="button"
              onClick={() => toggleFolder(node.path)}
              className="inline-flex h-4 w-4 items-center justify-center rounded hover:bg-zinc-200"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="inline-block h-4 w-4" />
          )}

          <button
            type="button"
            onClick={() => {
              if (isFolder) setSelectedFolderPath(node.path);
              if (nodeAsset) setSelectedAssetId(nodeAsset.id);
            }}
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
          >
            {isFolder ? (expanded ? <FolderOpen size={13} /> : <Folder size={13} />) : <FileText size={13} />}
            <span className="truncate">{node.name}</span>
          </button>
        </div>

        {isFolder && expanded && node.children.map((child) => renderTreeNode(child, depth + 1))}
      </div>
    );
  };

  const pickImportedSkill = (items: AgentSkillImportItemDTO[] | undefined): AgentSkillImportItemDTO | null => {
    if (!items || items.length === 0) return null;
    if (items.length === 1) return items[0];

    const lines = items.map((item, index) => `${index + 1}. ${item.skillName || "(unnamed)"} -> ${item.path || "-"}`);
    const input = window.prompt(
      `ZIP 中包含多个 SKILL，请输入要导入的序号（默认 1）:\n${lines.join("\n")}`,
      "1",
    );
    const index = Number(input || "1");
    if (!Number.isInteger(index) || index < 1 || index > items.length) {
      return items[0];
    }
    return items[index - 1];
  };

  const handleImportZip = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      window.alert("请选择 .zip 文件");
      return;
    }
    if (!userId) {
      window.alert("用户未登录");
      return;
    }

    const hasUnsavedContent =
      assets.length > 1 ||
      !assets.some((item) => item.kind === "file" && item.path === "SKILL.md" && item.content === DEFAULT_SKILL_MD);
    if (hasUnsavedContent) {
      const confirmed = window.confirm("导入 ZIP 会覆盖当前未保存的目录与文件，是否继续？");
      if (!confirmed) return;
    }

    setImportingZip(true);
    try {
      const importResponse = await agentService.importSkillZip(file, userId);
      if (importResponse.code !== SUCCESS_CODE || !importResponse.data) {
        throw new Error(importResponse.info || "ZIP 导入失败");
      }

      const picked = pickImportedSkill(importResponse.data.toolSkillsList);
      if (!picked?.path) {
        throw new Error("ZIP 中未识别到可用的 SKILL 目录");
      }

      const assetsResponse = await agentService.querySkillAssets(picked.path);
      if (assetsResponse.code !== SUCCESS_CODE || !assetsResponse.data) {
        throw new Error(assetsResponse.info || "读取导入后的 SKILL 目录失败");
      }

      const mapped = mapEntriesToAssets(assetsResponse.data.entries);
      setAssets(mapped);
      const first = mapped[0] || null;
      setSelectedAssetId(first?.id || "");
      setSelectedFolderPath(first ? (first.kind === "folder" ? first.path : getParentFolderPath(first.path)) : "");
      setExpandedFolders(collectInitialExpanded(mapped));

      if (!editingId && picked.skillName && picked.skillName.trim()) {
        try {
          setSkillName(normalizeSkillName(picked.skillName));
        } catch {
          // Ignore invalid name from zip package; user can edit manually.
        }
      }

      if (importResponse.data.skillCount > 1) {
        window.alert(`ZIP 导入成功，识别到 ${importResponse.data.skillCount} 个 SKILL，已加载所选目录。`);
      } else {
        window.alert("ZIP 导入成功");
      }
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "ZIP 导入失败");
    } finally {
      setImportingZip(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-zinc-100 to-slate-200 text-zinc-900">
      <div className="mx-auto w-full max-w-[1360px] px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="inline-flex items-center gap-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-100"
            >
              <ArrowLeft size={14} />
              返回
            </button>
            <h1 className="text-3xl font-semibold">{editingId ? "更新 SKILL" : "新建 SKILL"}</h1>
          </div>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || loadingProfile || importingZip}
            className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "保存中..." : "保存到 OSS 并写入配置"}
          </button>
        </div>

        {editingId ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            编辑模式：会先从 OSS 回读目录与文件，再按当前内容覆盖保存。
          </div>
        ) : null}

        <div className="rounded-2xl border border-zinc-200 bg-white/80 p-5 shadow-sm">
          <p className="mb-3 text-lg font-semibold text-zinc-800">目录与文件树</p>

          <div className="mb-3">
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className="hidden"
              onChange={(event) => void handleImportZip(event)}
            />
            <button
              type="button"
              onClick={() => zipInputRef.current?.click()}
              disabled={loadingProfile || saving || importingZip}
              className="inline-flex items-center gap-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importingZip ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {importingZip ? "正在导入 ZIP..." : "导入 ZIP"}
            </button>
          </div>

          <div className="mb-3 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
            <input
              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
              placeholder="SKILL 名称（如 drawio-skill）"
              value={skillName}
              onChange={(event) => setSkillName(event.target.value)}
              disabled={loadingProfile}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
            <div className="rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center gap-2 border-b border-zinc-200 px-2 py-2">
                <button
                  type="button"
                  onClick={quickAddFile}
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                >
                  <Plus size={12} />
                  新增文件
                </button>
                <button
                  type="button"
                  onClick={quickAddFolder}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                >
                  <Plus size={12} />
                  新增子文件夹
                </button>
                <button
                  type="button"
                  onClick={() => selectedFolderPath && deleteFolderByPath(selectedFolderPath)}
                  disabled={!selectedFolderPath}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={12} />
                  删除文件夹
                </button>
              </div>

              <div className="max-h-[470px] overflow-auto p-2">
                {treeNodes.map((node) => renderTreeNode(node, 0))}
                {!treeNodes.length ? (
                  <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-xs text-zinc-500">
                    还没有文件，先新增 `SKILL.md` 或其他文件。
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              {selectedAsset ? (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-md bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600">
                      {selectedAsset.kind === "file" ? "文件" : "目录"}
                    </span>
                    <input
                      className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                      value={pathEditor}
                      onChange={(event) => setPathEditor(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={applyPathUpdate}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      应用
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteAsset(selectedAsset.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                  </div>

                  {selectedAsset.kind === "file" ? (
                    <textarea
                      className="h-[380px] w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs outline-none ring-blue-200 transition focus:border-blue-400 focus:ring-2"
                      value={selectedAsset.content}
                      onChange={(event) => updateAssetContent(selectedAsset.id, event.target.value)}
                    />
                  ) : (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-500">
                      当前为目录节点，可修改路径或删除（删除目录会级联删除其下文件）。
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                  请在左侧选择一个文件或目录。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
