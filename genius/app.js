/* Choose your Genius plan — plan chooser screen. Vanilla JS, no dependencies. */
(function () {
  'use strict';

  var INR = '₹';
  var money = function (n) { return INR + n.toLocaleString('en-IN'); };

  /* ---------- data ---------- */

  var FEATURES = {
    mf: {
      title: 'MUTUAL FUNDS',
      items: [
        ['Personalised Ultimate SIP in MFs',
         'A ready-made SIP portfolio of 4–6 funds matched to your risk profile, rebalanced as markets move.'],
        ['Goal Pilot in MFs',
         'Plan any goal — retirement, a home, your child’s education — and get a fund plan that keeps it on track.'],
        ['Portfolio Fix',
         'A health check on the funds you already hold, with a switch plan for the ones dragging your returns.'],
        ['ET Money Select',
         'A curated list of funds across categories, refreshed every quarter on performance and consistency.'],
        ['ET Money Verdict',
         'A plain buy / hold / avoid call on 1,400+ funds, backed by 40+ data checks.']
      ]
    },
    stocks: {
      title: 'STOCKS & SIFS',
      items: [
        ['Specialized Investment funds (SIFs)',
         'Access the SIF category — long-short and hybrid strategies that were once limited to large investors.'],
        ['Personalised Ultimate SIP in Stocks & ETFs',
         'A diversified basket of stocks and ETFs bought through a monthly SIP and rebalanced for you.'],
        ['Goal Pilot in ETFs',
         'Goal-based investing through low-cost ETFs, with an allocation that turns conservative as the goal nears.']
      ]
    },
    tools: {
      title: 'INVESTING TOOLS',
      items: [
        ['Fund Report Card',
         'Every metric that matters for a fund — returns, risk, rolling consistency, portfolio overlap — on one page.'],
        ['Stock Report Card',
         'Fundamentals, valuation and quality scores for 4,000+ listed companies, in plain language.'],
        ['Portfolio Health',
         'One score for everything you hold across MFs, stocks and ETFs, plus what to fix first.']
      ]
    }
  };

  var PLANS = [
    {
      id: 'mf', name: 'Mutual Funds', mrp: 499, price: 299, then: 499,
      tagline: 'When mutual funds are all you invest in',
      sections: ['mf', 'tools']
    },
    {
      id: 'stocks', name: 'Stocks & SIF', mrp: 799, price: 599, then: 799,
      tagline: 'When you invest in stocks, ETFs and SIFs',
      sections: ['stocks', 'tools']
    },
    {
      id: 'combo', name: '2-in-One', mrp: 1298, price: 599, then: 999, deal: true,
      tagline: 'When you want everything that Genius has to offer',
      sections: ['mf', 'stocks', 'tools']
    }
  ];

  var saved = function (p) { return (p.mrp - p.price) * 12; };

  /* ---------- elements ---------- */

  var $ = function (id) { return document.getElementById(id); };
  var planRow = $('planRow'), features = $('features'), tagline = $('tagline');
  var payMrp = $('payMrp'), payPrice = $('payPrice'), payThen = $('payThen');
  var consent = $('consent'), consentCard = $('consentCard');
  var sheet = $('sheet'), scrim = $('scrim'), sheetTitle = $('sheetTitle'), sheetBody = $('sheetBody');
  var toastEl = $('toast'), paybar = $('paybar'), scroller = $('scroller');

  var selectedId = localStorage.getItem('genius.plan') || 'combo';
  if (!PLANS.some(function (p) { return p.id === selectedId; })) selectedId = 'combo';
  var current = function () {
    return PLANS.filter(function (p) { return p.id === selectedId; })[0];
  };

  /* ---------- render ---------- */

  function renderPlans() {
    planRow.innerHTML = '';
    PLANS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'plan' + (p.deal ? ' deal' : '') + (p.id === selectedId ? ' selected' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(p.id === selectedId));
      b.dataset.plan = p.id;
      b.innerHTML =
        '<span class="ribbon">⚡ Lightning deal ⚡</span>' +
        '<span class="card">' +
          '<span class="card-top">' +
            '<span class="brand">Genius</span>' +
            '<span class="pname">' + p.name + '</span>' +
            '<span class="pprice"><s>' + money(p.mrp) + '</s>' + money(p.price) + '</span>' +
          '</span>' +
          '<span class="save">Save ' + money(saved(p)) + ' in 12 months</span>' +
        '</span>' +
        '<span class="pointer"></span>';
      b.addEventListener('click', function () { select(p.id); });
      planRow.appendChild(b);
    });
  }

  function renderFeatures() {
    var p = current();
    features.innerHTML = '';
    p.sections.forEach(function (key) {
      var group = FEATURES[key];
      var sec = document.createElement('section');
      sec.className = 'group';
      var h = document.createElement('h2');
      h.textContent = group.title;
      sec.appendChild(h);

      group.items.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'feat';
        row.innerHTML =
          '<button type="button" class="feat-btn" aria-expanded="false">' +
            '<span class="tick">' +
              '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
                '<path d="M5 12.5l4.6 4.6L19 7.5" fill="none" stroke="currentColor" ' +
                'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</span>' +
            '<span class="feat-name"></span>' +
            '<span class="plus" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" width="20" height="20">' +
                '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" ' +
                'stroke-width="1.8" stroke-linecap="round"/></svg>' +
            '</span>' +
          '</button>' +
          '<div class="feat-body"></div>';
        row.querySelector('.feat-name').textContent = item[0];
        row.querySelector('.feat-body').textContent = item[1];
        var btn = row.querySelector('.feat-btn');
        btn.addEventListener('click', function () {
          var open = row.classList.toggle('open');
          btn.setAttribute('aria-expanded', String(open));
        });
        sec.appendChild(row);
      });
      features.appendChild(sec);
    });
  }

  function renderPay() {
    var p = current();
    tagline.textContent = p.tagline;
    payMrp.textContent = money(p.mrp);
    payPrice.textContent = money(p.price);
    payThen.textContent = money(p.then);
  }

  function select(id) {
    if (id === selectedId) return;
    selectedId = id;
    try { localStorage.setItem('genius.plan', id); } catch (e) { /* private mode */ }
    Array.prototype.forEach.call(planRow.children, function (el) {
      var on = el.dataset.plan === id;
      el.classList.toggle('selected', on);
      el.setAttribute('aria-checked', String(on));
    });
    renderFeatures();
    renderPay();
  }

  /* keep the scroll padding in step with the real pay-bar height */
  function syncPayHeight() {
    document.documentElement.style.setProperty('--pay-h', paybar.offsetHeight + 'px');
  }

  /* ---------- sheets, toast ---------- */

  function openSheet(title, html) {
    sheetTitle.textContent = title;
    sheetBody.innerHTML = html;
    sheet.hidden = false;
    scrim.hidden = false;
    $('sheetClose').focus();
  }
  function closeSheet() { sheet.hidden = true; scrim.hidden = true; }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* ---------- wiring ---------- */

  $('seeHow').addEventListener('click', function (e) {
    e.preventDefault();
    var p = current();
    openSheet('How the fee is charged',
      '<p>For the first 12 months you pay the offer price. After that, the fee for ' +
      'Genius <b>' + p.name + '</b> is whichever of these two is higher:</p>' +
      '<div class="rows">' +
        '<div><span>Flat monthly fee</span><b>' + money(p.then) + ' p.m.</b></div>' +
        '<div><span>0.05% p.m. of Genius advised investments</span><b>' +
          money(Math.round(p.then / 0.0005)) + '+ invested</b></div>' +
      '</div>' +
      '<p>So the flat fee applies until your Genius-advised corpus crosses about ' +
      money(Math.round(p.then / 0.0005)) + '; above that the fee is 0.05% per month of ' +
      'that corpus. Billing is quarterly, GST as applicable, and you can cancel anytime.</p>');
  });

  $('agreement').addEventListener('click', function (e) {
    e.preventDefault();
    openSheet('Investment Advisory agreement',
      '<p>By consenting you enter into an advisory agreement with ET Money Genius covering:</p>' +
      '<ul>' +
        '<li>The advice and tools included in the plan you selected.</li>' +
        '<li>The fee shown on this screen, billed quarterly, plus GST.</li>' +
        '<li>Your risk profile, which the advice is matched to and which you can update anytime.</li>' +
        '<li>Cancellation at any time, with unused fees refunded on a pro-rata basis.</li>' +
      '</ul>' +
      '<p>The full agreement is shown before payment is taken.</p>');
  });

  $('sheetClose').addEventListener('click', closeSheet);
  scrim.addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !sheet.hidden) closeSheet();
  });

  $('proceed').addEventListener('click', function () {
    if (!consent.checked) {
      consentCard.classList.remove('nudge');
      void consentCard.offsetWidth;
      consentCard.classList.add('nudge');
      consentCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Please accept the advisory agreement to continue.');
      return;
    }
    var p = current();
    openSheet('Confirm your plan',
      '<div class="rows">' +
        '<div><span>Plan</span><b>Genius ' + p.name + '</b></div>' +
        '<div><span>Price for 12 months</span><b>' + money(p.price) + ' p.m.</b></div>' +
        '<div><span>You save</span><b>' + money(saved(p)) + '</b></div>' +
        '<div><span>Billed quarterly</span><b>' + money(p.price * 3) + ' + GST</b></div>' +
      '</div>' +
      '<p>This demo stops here — no payment is taken and nothing is sent anywhere.</p>');
  });

  $('back').addEventListener('click', function () {
    if (history.length > 1) history.back(); else toast('This is the first screen.');
  });

  /* ---------- go ---------- */

  renderPlans();
  renderFeatures();
  renderPay();
  syncPayHeight();
  window.addEventListener('resize', syncPayHeight);
  if (window.ResizeObserver) new ResizeObserver(syncPayHeight).observe(paybar);
  scroller.scrollTop = 0;
})();
