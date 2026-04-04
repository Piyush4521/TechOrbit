const quickStats = [
  { value: "186", label: "Citizen services online" },
  { value: "24/7", label: "Emergency and helpline support" },
  { value: "5.2M", label: "Applications processed this year" },
];

const serviceCards = [
  {
    id: "01",
    title: "Certificates and Identity",
    text: "Apply for birth, residence, income, and family certificates through one shared portal.",
  },
  {
    id: "02",
    title: "Land and Property Records",
    text: "Review ownership details, mutation status, digital maps, and approved registry services.",
  },
  {
    id: "03",
    title: "Taxes and Utilities",
    text: "Access property tax, water, power, and municipal billing updates in one place.",
  },
  {
    id: "04",
    title: "Social Welfare Schemes",
    text: "Browse pensions, scholarships, subsidies, and household benefit programs by eligibility.",
  },
  {
    id: "05",
    title: "Business and Trade Licenses",
    text: "Track registrations, permits, renewals, and inspections for local enterprises.",
  },
  {
    id: "06",
    title: "Public Grievance Cell",
    text: "Submit complaints, follow status updates, and review department response timelines.",
  },
];

const notices = [
  {
    tag: "Announcement",
    title: "Citizen service centers to extend hours during enrollment week",
    text: "Walk-in counters across district offices will remain open until 8:00 PM from Monday to Saturday.",
  },
  {
    tag: "Public Notice",
    title: "Urban housing subsidy applications reopen for the 2026 intake cycle",
    text: "Online registrations and document uploads are available now through the housing assistance desk.",
  },
  {
    tag: "Advisory",
    title: "Monsoon preparedness helpline activated for coastal and river communities",
    text: "Weather response teams, shelter details, and district control room contacts are live on the portal.",
  },
];

const departments = [
  {
    title: "Health and Family Welfare",
    text: "Vaccination drives, district hospital services, insurance enrollment, and health outreach updates.",
  },
  {
    title: "Education and Skills",
    text: "School admissions, scholarship forms, digital classrooms, and workforce development programs.",
  },
  {
    title: "Agriculture and Rural Support",
    text: "Crop advisories, procurement schedules, irrigation support, and market access initiatives.",
  },
  {
    title: "Transport and Public Works",
    text: "Road maintenance notices, mobility projects, permits, and regional transit improvements.",
  },
];

const initiatives = [
  {
    phase: "Digital Access",
    title: "Single-sign-on services for citizens and businesses",
    text: "A unified identity layer is reducing paperwork and improving access to core public services.",
  },
  {
    phase: "Transparent Delivery",
    title: "Open dashboards for budgets, works, and service timelines",
    text: "Departments publish measurable delivery targets with updated progress snapshots each quarter.",
  },
  {
    phase: "Community First",
    title: "Ward-level support desks and multilingual assistance",
    text: "Local help centers expand offline access for applicants who need in-person guidance.",
  },
];

const governanceCards = [
  {
    heading: "Live service standards",
    items: ["Average certificate turnaround: 3 working days", "Utility grievance response: under 24 hours", "License renewal completion: 92% within target time"],
  },
  {
    heading: "Public information",
    items: ["Budgets and annual reports", "Tender notices and procurement updates", "Right to information resources"],
  },
  {
    heading: "Citizen support",
    items: ["Unified helpline 1800-400-2026", "District office directory", "Accessibility and language support"],
  },
];

function SectionHeading({ eyebrow, title, text }) {
  return (
    <div className="section-heading">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

function App() {
  return (
    <div className="app-shell">
      <div className="official-strip">
        <p>An official public service portal for citizen information and digital access.</p>
        <div className="official-links">
          <a href="#services">Services</a>
          <a href="#notices">Notices</a>
          <a href="#contact">Contact</a>
        </div>
      </div>

      <header className="site-header">
        <div className="brand-lockup">
          <div className="seal-mark" aria-hidden="true">
            NC
          </div>
          <div>
            <strong>National Civic Portal</strong>
            <p>Department of Public Services and Citizen Access</p>
          </div>
        </div>

        <nav className="main-nav" aria-label="Primary navigation">
          <a href="#home">Home</a>
          <a href="#services">Services</a>
          <a href="#departments">Departments</a>
          <a href="#initiatives">Initiatives</a>
          <a href="#contact">Contact</a>
        </nav>

        <div className="header-actions">
          <button type="button" className="btn btn-secondary">
            Track Application
          </button>
          <button type="button" className="btn btn-primary">
            Citizen Login
          </button>
        </div>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-copy">
            <p className="eyebrow">Public service delivery</p>
            <h1>Government services with a clearer path from information to action.</h1>
            <p className="hero-text">
              Discover services, review notices, track applications, and reach the right
              department through one modern civic interface built for trust and clarity.
            </p>

            <div className="hero-actions">
              <button type="button" className="btn btn-primary">
                Apply for Services
              </button>
              <button type="button" className="btn btn-ghost">
                Explore Departments
              </button>
            </div>

            <div className="stats-grid">
              {quickStats.map((stat) => (
                <article key={stat.label} className="stat-card">
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                </article>
              ))}
            </div>
          </div>

          <aside className="hero-panel" aria-label="Portal highlights">
            <div className="panel-topline">
              <span className="status-dot" />
              Portal status: All critical services online
            </div>

            <div className="panel-card">
              <h3>Quick access</h3>
              <ul>
                <li>Download certificates</li>
                <li>Check welfare eligibility</li>
                <li>Review district office contacts</li>
                <li>Raise a grievance or appeal</li>
              </ul>
            </div>

            <div className="panel-card accent-card">
              <p className="mini-label">Current priority</p>
              <h3>Seasonal emergency response readiness</h3>
              <p>
                Updated district advisories, relief shelters, and emergency numbers are
                available for public access.
              </p>
            </div>
          </aside>
        </section>

        <section className="alert-banner" aria-label="Important update">
          <div>
            <span className="alert-label">Important update</span>
            <p>Digital grievance filing and certificate verification are available across all districts.</p>
          </div>
          <a href="#notices">View latest notices</a>
        </section>

        <section className="services-section" id="services">
          <SectionHeading
            eyebrow="Core services"
            title="Popular citizen services in one accessible grid"
            text="The homepage structure is designed around common public interactions so visitors can move quickly without guessing where to begin."
          />

          <div className="services-grid">
            {serviceCards.map((service) => (
              <article key={service.id} className="service-card">
                <span className="service-id">{service.id}</span>
                <h3>{service.title}</h3>
                <p>{service.text}</p>
                <a href="/">Open service</a>
              </article>
            ))}
          </div>
        </section>

        <section className="notice-section" id="notices">
          <div className="notice-column">
            <SectionHeading
              eyebrow="Latest notices"
              title="Public updates and time-sensitive announcements"
              text="This section keeps policy notices, enrollment windows, and advisories visible without overwhelming the primary service journey."
            />

            <div className="notice-list">
              {notices.map((notice) => (
                <article key={notice.title} className="notice-card">
                  <span>{notice.tag}</span>
                  <h3>{notice.title}</h3>
                  <p>{notice.text}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="support-panel">
            <div className="support-card dark">
              <p className="mini-label">Emergency contacts</p>
              <h3>Public response helpline</h3>
              <p>For urgent civic, weather, and regional assistance services.</p>
              <strong>1800-400-2026</strong>
            </div>

            <div className="support-card">
              <p className="mini-label">Need assistance</p>
              <h3>Citizen help desk</h3>
              <p>Guided support for applications, accessibility, and department routing.</p>
              <button type="button" className="btn btn-secondary wide">
                Contact support
              </button>
            </div>
          </aside>
        </section>

        <section className="departments-section" id="departments">
          <SectionHeading
            eyebrow="Department directory"
            title="A structured gateway to major public departments"
            text="The layout highlights the most visited departments first, helping residents, businesses, and institutions find the right administrative path."
          />

          <div className="department-grid">
            {departments.map((department) => (
              <article key={department.title} className="department-card">
                <h3>{department.title}</h3>
                <p>{department.text}</p>
                <a href="/">Visit section</a>
              </article>
            ))}
          </div>
        </section>

        <section className="initiatives-section" id="initiatives">
          <div className="initiatives-copy">
            <SectionHeading
              eyebrow="Transformation agenda"
              title="Public service initiatives focused on trust, visibility, and reach"
              text="A government-style interface works best when it communicates both services and long-term institutional priorities."
            />
          </div>

          <div className="initiative-timeline">
            {initiatives.map((initiative) => (
              <article key={initiative.title} className="initiative-card">
                <span>{initiative.phase}</span>
                <h3>{initiative.title}</h3>
                <p>{initiative.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="governance-section">
          <SectionHeading
            eyebrow="Transparency and accountability"
            title="Information blocks that support public trust"
            text="This area gives the homepage the institutional depth expected from a modern government portal."
          />

          <div className="governance-grid">
            {governanceCards.map((card) => (
              <article key={card.heading} className="governance-card">
                <h3>{card.heading}</h3>
                <ul>
                  {card.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer" id="contact">
        <div className="footer-top">
          <div>
            <p className="mini-label">National Civic Portal</p>
            <h2>Designed for public access, service discovery, and clear communication.</h2>
          </div>
          <button type="button" className="btn btn-primary">
            View all services
          </button>
        </div>

        <div className="footer-grid">
          <div>
            <h3>Citizen resources</h3>
            <a href="/">Forms and downloads</a>
            <a href="/">Application tracking</a>
            <a href="/">Helplines and support</a>
          </div>
          <div>
            <h3>Open government</h3>
            <a href="/">Budgets and reports</a>
            <a href="/">Procurement and tenders</a>
            <a href="/">Right to information</a>
          </div>
          <div>
            <h3>Department contact</h3>
            <p>Central Secretariat Avenue</p>
            <p>Civic District, New Capital Region</p>
            <p>support@ncp.gov</p>
          </div>
        </div>

        <div className="footer-bottom">
          <p>Copyright 2026 National Civic Portal. All rights reserved.</p>
          <div>
            <a href="/">Accessibility</a>
            <a href="/">Privacy</a>
            <a href="/">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
