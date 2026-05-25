'use client'

// VITAS v2 Sidebar — extracted from design_handoff_vitas_hitech_refresh/screen-2-hakol-v2.html
// Near-black bg (#0B0F1E) with subtle violet glow on active project.
// Client list with nested projects.
//
// Drop-in usage from admin/page.js:
//   <Sidebar
//     clients={clients}            // [{name, color, projects:[{name, id}]}, ...]
//     activeClient={'ש.ברוך'}
//     activeProject={'HI PARK'}
//     onSelectProject={(client, project) => selectProject(client, project)}
//     onAddClient={...}            // optional
//     onAddProject={(client) => ...}  // optional
//     footerText={'VITAS Reports v3.2 · עודכן 23.05.2026'}
//   />
//
// The clients array shape matches existing loadClients() output from admin/page.js.

export default function Sidebar({
  clients = [],
  activeClient,
  activeProject,
  onSelectClient,
  onSelectProject,
  onAddClient,
  onAddProject,
  lockedProjects = [],
  footerText = 'VITAS Reports v3.2',
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-inner" style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 60px)' }}>
        <div className="sidebar-section">
          <div className="sidebar-title">לקוחות</div>

          {clients.map((client) => {
            const isActive = client.name === activeClient;
            return (
              <div className="client-item" key={client.name}>
                <div
                  className={`client-header ${isActive ? 'active' : ''}`}
                  onClick={() => onSelectClient?.(client)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', color: isActive ? 'white' : 'var(--side-fg)',
                    fontWeight: isActive ? 800 : 600, fontSize: 14,
                    background: isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    className="client-dot"
                    style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: client.color || 'var(--indigo)',
                    }}
                  />
                  {client.name}
                </div>

                {isActive && (client.projects || []).map((project) => {
                  const isCurrent = project.name === activeProject;
                  const isLocked = lockedProjects.includes(project.name);
                  return (
                    <div
                      key={project.id || project.name}
                      className={`project-item ${isCurrent ? 'active' : ''} ${isLocked ? 'locked' : ''}`}
                      onClick={() => !isLocked && onSelectProject?.(client, project)}
                      title={isLocked ? 'פרויקט נעול' : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 14px 8px 24px',
                        marginRight: 14,
                        color: isLocked ? 'var(--side-fg-mute)' : isCurrent ? 'white' : 'var(--side-fg)',
                        fontWeight: isCurrent ? 700 : 500, fontSize: 13,
                        background: isCurrent ? 'var(--side-active)' : 'transparent',
                        borderRadius: 8,
                        cursor: isLocked ? 'not-allowed' : 'pointer',
                        borderRight: isCurrent ? '2px solid var(--indigo)' : '2px solid transparent',
                        opacity: isLocked ? 0.45 : 1,
                        transition: 'all var(--dur) var(--ease-out)',
                      }}
                    >
                      {isLocked
                        ? <span style={{ fontSize: 12, opacity: 0.7 }}>🔒</span>
                        : (project.icon || '🏗️')
                      }
                      <span dir="ltr">{project.name}</span>
                    </div>
                  );
                })}

                {isActive && onAddProject && (
                  <div
                    className="add-btn indent"
                    onClick={() => onAddProject(client)}
                  >
                    + פרויקט חדש
                  </div>
                )}
              </div>
            );
          })}

          {onAddClient && (
            <div className="add-btn" onClick={onAddClient}>
              + לקוח חדש
            </div>
          )}
        </div>

        {footerText && (
          <div
            className="sidebar-foot"
            style={{
              marginTop: 'auto',
              padding: '18px 24px 16px',
              borderTop: '1px solid var(--side-divider)',
              fontSize: 12,
              color: 'var(--side-fg-mute)',
              lineHeight: 1.6,
            }}
          >
            <span dir="ltr">{footerText}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
