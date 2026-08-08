export const routes = {
  home: () => "/",
  upload: () => "/upload",
  recentProjects: () => "/projects",
  matchProjects: (matchId) => `/matches/${encodeURIComponent(matchId)}/projects`,
  projectEdit: (projectId) => `/projects/${encodeURIComponent(projectId)}/edit`,
  projectExport: (projectId) => `/projects/${encodeURIComponent(projectId)}/export`,
};

export function parseRoute(pathname) {
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "home" };
  if (path === "/upload") return { name: "upload" };
  if (path === "/projects") return { name: "recent-projects" };

  const matchProjects = path.match(/^\/matches\/([^/]+)\/projects$/);
  if (matchProjects) {
    return { name: "match-projects", matchId: decodeURIComponent(matchProjects[1]) };
  }

  const projectEdit = path.match(/^\/projects\/([^/]+)\/(edit|export)$/);
  if (projectEdit) {
    return {
      name: projectEdit[2] === "export" ? "project-export" : "project-edit",
      projectId: decodeURIComponent(projectEdit[1]),
    };
  }

  return { name: "not-found" };
}

export function routePath(route) {
  switch (route.name) {
    case "home": return routes.home();
    case "upload": return routes.upload();
    case "recent-projects": return routes.recentProjects();
    case "match-projects": return routes.matchProjects(route.matchId);
    case "project-edit": return routes.projectEdit(route.projectId);
    case "project-export": return routes.projectExport(route.projectId);
    default: return routes.home();
  }
}

export function screenForRoute(route) {
  if (route.name === "recent-projects") return "projects";
  if (route.name === "match-projects") return "match-projects";
  if (route.name === "project-edit") return "edit";
  if (route.name === "project-export") return "preview";
  return "upload";
}
