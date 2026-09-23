import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Droplets,
  IndianRupee,
  Leaf,
  Moon,
  Play,
  Sprout,
  Sun,
  TrendingUp,
  Users,
  Wifi,
  Waves,
  Gauge,
  ShieldCheck,
} from "lucide-react";

import "./App.css";

function App() {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
  }, [darkMode]);

  return (
    <div className={`app ${darkMode ? "dark" : ""}`}>

      {/* ================= NAVBAR ================= */}

      <header className="navbar">
        <a href="#home" className="brand">
          <div className="brand-mark">
            <Leaf size={30} strokeWidth={2.2} />
          </div>

          <div className="brand-copy">
            <strong>ARIGATO</strong>
            <span>Smart Irrigation</span>
          </div>
        </a>

        <nav className="nav-links">
          <a className="active" href="#home">
            Home
          </a>

          <a href="#dashboard">
            Dashboard
          </a>

          <a href="#about">
            About
          </a>

          <a href="#team">
            Our Team
          </a>
        </nav>

        <div className="nav-actions">
          <button
            className="theme-button"
            onClick={() => setDarkMode((current) => !current)}
            aria-label="Toggle dark mode"
          >
            {darkMode ? <Sun size={19} /> : <Moon size={19} />}
          </button>

          <button className="live-button">
            <Wifi size={17} />
            <span>Live Demo</span>
          </button>
        </div>
      </header>

      {/* ================= HERO ================= */}

      <main id="home" className="hero">

        <div className="hero-shade" />

        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />

        <section className="hero-content">

          <div className="hero-kicker">
            <span className="kicker-line" />

            <span>
              SENSING TODAY. SMARTER DECISIONS FOR TOMORROW.
            </span>
          </div>

          <h1 className="hero-title">
            Smarter Irrigation
            <span>Healthier Farms</span>
          </h1>

          <p className="hero-description">
            A low-cost IoT intelligence system helping smallholder
            farmers make better irrigation decisions using real-time
            field data — so every drop of water creates more value.
          </p>

          <div className="hero-actions">

            <a className="primary-button" href="#dashboard">
              <BarChart3 size={19} />
              View Live Dashboard
              <ArrowRight size={18} />
            </a>

            <a className="secondary-button" href="#about">
              <span className="play-icon">
                <Play size={13} fill="currentColor" />
              </span>

              How It Works
            </a>

          </div>

          <div className="benefits">

            <Benefit
              icon={<Droplets size={22} />}
              title="Conserve"
              subtitle="Water"
            />

            <Benefit
              icon={<TrendingUp size={22} />}
              title="Improve"
              subtitle="Yield"
            />

            <Benefit
              icon={<IndianRupee size={22} />}
              title="Reduce"
              subtitle="Costs"
            />

            <Benefit
              icon={<Users size={22} />}
              title="Support"
              subtitle="Farmers"
            />

          </div>

        </section>

        {/* ================= LIVE FIELD CARD ================= */}

        <aside className="field-card">

          <div className="field-card-top">

            <div className="field-status-title">
              <span className="live-dot" />
              <strong>Live Field Status</strong>
            </div>

            <span className="node-id">
              FIELD NODE 01
            </span>

          </div>

          <SensorRow
            icon={<Droplets size={18} />}
            name="Water / Rain"
            value="Clear"
            state="success"
          />

          <SensorRow
            icon={<Waves size={18} />}
            name="Tank Level"
            value="--"
            state="neutral"
          />

          <SensorRow
            icon={<Sprout size={18} />}
            name="Soil Moisture"
            value="Not connected"
            state="warning"
          />

          <SensorRow
            icon={<Wifi size={18} />}
            name="Node Status"
            value="Online"
            state="success"
          />

          <div className="field-card-bottom">

            <span>
              <Wifi size={14} />
              ESP32 connected
            </span>

            <span className="field-time">
              Prototype
            </span>

          </div>

        </aside>

        <div className="impact-note">
          <span>Small ideas.</span>
          <strong>Big impact.</strong>
          <i />
        </div>

        <div className="scroll-indicator">
          <span>EXPLORE</span>
          <div />
        </div>

      </main>

      {/* ================= VALUE STRIP ================= */}

      <section className="value-strip">

        <ValueCard
          icon={<Droplets size={25} />}
          heading="Smarter Water Use"
          text="Irrigate only when conditions require it"
        />

        <ValueCard
          icon={<TrendingUp size={25} />}
          heading="Better Decisions"
          text="Convert field readings into clear actions"
        />

        <ValueCard
          icon={<IndianRupee size={25} />}
          heading="Lower Waste"
          text="Reduce unnecessary pumping and water use"
        />

        <ValueCard
          icon={<ShieldCheck size={25} />}
          heading="Explainable"
          text="Show farmers why each action is recommended"
        />

      </section>

      {/* ================= MINI PRODUCT INTRO ================= */}

      <section id="about" className="product-intro">

        <div className="section-label">
          <span />
          THE IDEA
        </div>

        <div className="intro-grid">

          <div className="intro-heading">

            <h2>
              From field signals
              <span>to useful decisions.</span>
            </h2>

          </div>

          <div className="intro-copy">

            <p>
              Arigato combines a lightweight field node with an
              intelligent software layer. Instead of adding hardware
              for every possible measurement, the system focuses on
              useful signals and turns them into practical irrigation
              guidance.
            </p>

            <div className="intro-points">

              <MiniPoint
                icon={<Gauge size={19} />}
                title="Sense"
                text="Capture field conditions"
              />

              <MiniPoint
                icon={<Wifi size={19} />}
                title="Connect"
                text="Transmit live readings"
              />

              <MiniPoint
                icon={<Leaf size={19} />}
                title="Decide"
                text="Recommend the next action"
              />

            </div>

          </div>

        </div>

      </section>

      {/* ================= DASHBOARD PLACEHOLDER ================= */}

      <section id="dashboard" className="dashboard-preview">

        <div className="dashboard-preview-content">

          <div className="section-label light-label">
            <span />
            LIVE INTELLIGENCE
          </div>

          <h2>
            One field.
            <span>One clear decision.</span>
          </h2>

          <p>
            The next stage of the prototype will connect this interface
            to the ESP32 and convert incoming sensor readings into a
            real-time irrigation recommendation.
          </p>

          <div className="coming-chip">
            <span className="live-dot" />
            Dashboard engine coming next
          </div>

        </div>

        <div className="dashboard-visual">

          <div className="decision-card">

            <div className="decision-card-header">
              <span>IRRIGATION ENGINE</span>
              <span className="engine-status">
                READY
              </span>
            </div>

            <div className="decision-main">
              <div className="decision-icon">
                <Leaf size={30} />
              </div>

              <div>
                <small>CURRENT RECOMMENDATION</small>
                <strong>Awaiting field data</strong>
              </div>
            </div>

            <div className="decision-grid">

              <div>
                <span>Rain</span>
                <strong>Clear</strong>
              </div>

              <div>
                <span>Tank</span>
                <strong>Pending</strong>
              </div>

              <div>
                <span>Confidence</span>
                <strong>--</strong>
              </div>

            </div>

          </div>

        </div>

      </section>

      {/* ================= TEAM PLACEHOLDER ================= */}

      <section id="team" className="team-section">

        <div>
          <div className="section-label">
            <span />
            BUILT FOR NIRMAAN 2026
          </div>

          <h2>Arigato Algorithms</h2>

          <p>
            Building a focused, low-cost irrigation prototype around
            practical sensing, intelligent decisions and a clear farmer
            experience.
          </p>
        </div>

        <div className="team-badge">
          <Leaf size={28} />
          <div>
            <span>BUILD.</span>
            <span>INNOVATE.</span>
            <strong>IMPACT.</strong>
          </div>
        </div>

      </section>

      {/* ================= FOOTER ================= */}

      <footer className="footer">

        <div className="footer-main">

          <div className="footer-brand">

            <div className="brand footer-logo">

              <div className="brand-mark">
                <Leaf size={29} />
              </div>

              <div className="brand-copy">
                <strong>ARIGATO</strong>
                <span>Smart Irrigation</span>
              </div>

            </div>

            <p>
              A smarter, more sustainable approach to irrigation for
              smallholder farms.
            </p>

          </div>

          <div className="footer-links">

            <h4>Explore</h4>

            <a href="#home">Home</a>
            <a href="#dashboard">Dashboard</a>
            <a href="#about">About</a>
            <a href="#team">Our Team</a>

          </div>

          <div className="footer-links">

            <h4>Prototype</h4>

            <span>ESP32 Field Node</span>
            <span>Live Dashboard</span>
            <span>Decision Engine</span>
            <span>Anomaly Detection</span>

          </div>

          <div className="footer-statement">

            <Leaf size={24} />

            <p>
              Technology for a
              <strong> greener tomorrow.</strong>
            </p>

          </div>

        </div>

        <div className="footer-bottom">

          <span>
            © 2026 Arigato Algorithms
          </span>

          <div>
            <span>BMSITM</span>
            <i />
            <span>NIRMAAN 2026</span>
          </div>

        </div>

      </footer>

    </div>
  );
}


function Benefit({ icon, title, subtitle }) {
  return (
    <div className="benefit">

      <div className="benefit-icon">
        {icon}
      </div>

      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>

    </div>
  );
}


function SensorRow({ icon, name, value, state }) {
  return (
    <div className="sensor-row">

      <div className="sensor-name">

        <span className="sensor-icon">
          {icon}
        </span>

        <span>{name}</span>

      </div>

      <strong className={`sensor-value ${state}`}>
        {value}
      </strong>

    </div>
  );
}


function ValueCard({ icon, heading, text }) {
  return (
    <article className="value-card">

      <div className="value-icon">
        {icon}
      </div>

      <div>
        <h3>{heading}</h3>
        <p>{text}</p>
      </div>

    </article>
  );
}


function MiniPoint({ icon, title, text }) {
  return (
    <div className="mini-point">

      <div>
        {icon}
      </div>

      <p>
        <strong>{title}</strong>
        <span>{text}</span>
      </p>

    </div>
  );
}


export default App;