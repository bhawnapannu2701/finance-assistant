// --------- Firebase Setup ----------
const firebaseConfig = {
    apiKey: "AIzaSyDGEkIuqsGCFnGyUfpRlAksHl4k-go1gvk",
    authDomain: "financeapp-46b13.firebaseapp.com",
    projectId: "financeapp-46b13",
    storageBucket: "financeapp-46b13.firebasestorage.app",
    messagingSenderId: "261915330532",
    appId: "1:261915330532:web:8d4bd1cbce1c1ba1f829f1",
    measurementId: "G-CBGY7DR8HD"
  };
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  
  // --------- State & Elements ----------
  let expenses = [], monthlyBudget = 0, chart = null;
  let recurrences = [];
  const loginPage     = document.getElementById('login-signup-page');
  const dashboardPage = document.getElementById('dashboard-page');
  const subpages      = document.querySelectorAll('.subpage');
  const toastContainer = document.getElementById('toast-container');
  
  // --------- Auth Guard ----------
  auth.onAuthStateChanged(user => {
    if (user && user.emailVerified) {
      loadUserData(user.uid);
      showSubpage('budget');
      loginPage.style.display = 'none';
      dashboardPage.style.display = 'flex';
    } else {
      auth.signOut();
      loginPage.style.display = 'flex';
      dashboardPage.style.display = 'none';
    }
  });
  
  // --------- Auth Flows ----------
  document.getElementById('signup-btn').onclick = () => {
    const e = document.getElementById('signup-email').value;
    const p = document.getElementById('signup-password').value;
    auth.createUserWithEmailAndPassword(e,p)
      .then(u=>u.user.sendEmailVerification())
      .catch(err=>alert(err.message));
  };
  document.getElementById('login-btn').onclick = () => {
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    auth.signInWithEmailAndPassword(e,p)
      .then(u=>{
        if (!u.user.emailVerified) {
          alert('Please verify your email.');
          auth.signOut();
        }
      })
      .catch(err=>alert(err.message));
  };
  document.getElementById('reset-password').onclick = () => {
    const e = document.getElementById('login-email').value || document.getElementById('signup-email').value;
    if(!e) return alert('Enter email to reset');
    auth.sendPasswordResetEmail(e).then(()=>alert('Reset email sent')).catch(err=>alert(err.message));
  };
  document.getElementById('verify-email').onclick = () => {
    const u = auth.currentUser;
    if(u) u.sendEmailVerification().then(()=>alert('Verification email sent'));
  };
  document.getElementById('logout-btn').onclick = () => auth.signOut();
  
  // --------- Navigation ----------
  document.querySelectorAll('.nav-bar button[data-page]').forEach(btn=>{
    btn.onclick = ()=> showSubpage(btn.dataset.page);
  });
  function showSubpage(id){
    subpages.forEach(s=>s.style.display='none');
    document.getElementById(id).style.display='block';
    // trigger animations if any
  }
  
  // --------- Load User Data ----------
  function loadUserData(uid){
    // Monthly reset
    const last = localStorage.getItem('lastDate'), now = new Date();
    if (!last || new Date(last).getMonth() !== now.getMonth()) {
      localStorage.setItem('lastDate', now.toISOString());
      // clear expenses & history
      db.collection('users').doc(uid).collection('expenses').get().then(s=>{
        const b=db.batch(); s.forEach(d=>b.delete(d.ref)); return b.commit();
      });
      db.collection('users').doc(uid).collection('monthlyHistory').get().then(s=>{
        const b=db.batch(); s.forEach(d=>b.delete(d.ref)); return b.commit();
      });
      // populate recurring
      db.collection('users').doc(uid).collection('recurring').get().then(snap=>{
        snap.forEach(r=>{
          const data = r.data();
          db.collection('users').doc(uid).collection('expenses')
            .add({ description:data.description, amount:data.amount, category:data.category, date:firebase.firestore.FieldValue.serverTimestamp() });
        });
      });
    }
    localStorage.setItem('lastDate', now.toISOString());
  
    // Load budget & profile
    db.collection('users').doc(uid).onSnapshot(doc=>{
      const d = doc.data()||{};
      monthlyBudget = d.monthlyBudget||0;
      document.getElementById('budgetInput').value = monthlyBudget;
      if(d.profile) applyProfile(d.profile);
      if(d.categoryBudgets) renderCategoryBudgets(d.categoryBudgets);
    });
  
    // Load expenses & history
    db.collection('users').doc(uid).collection('expenses').orderBy('date')
      .onSnapshot(snap=>{
        expenses = snap.docs.map(d=>({ id:d.id,...d.data() }));
        updateExpenseList(); updateTotalAmount(); updateRemainingBudget();
        // update monthly history
        const monthKey = new Date().toISOString().slice(0,7);
        const spent = expenses.reduce((s,e)=>s+e.amount,0);
        db.collection('users').doc(uid).collection('monthlyHistory')
          .doc(monthKey).set({ month:monthKey, totalSpent:spent },{merge:true});
      });
  
    // Load history chart
    db.collection('users').doc(uid).collection('monthlyHistory').orderBy('month')
      .onSnapshot(snap=>{
        const labels=[],data=[];
        snap.docs.forEach(d=>{ labels.push(d.id); data.push(d.data().totalSpent); });
        renderHistoryChart(labels,data);
      });
  
    // Load recurring
    db.collection('users').doc(uid).collection('recurring')
      .onSnapshot(snap=>{
        recurrences = snap.docs.map(d=>({ id:d.id, ...d.data() }));
        renderRecurring();
      });
  }
  
  // --------- Budget & Expenses ----------
  document.getElementById('set-budget-btn').onclick = ()=>{
    const v=parseFloat(document.getElementById('budgetInput').value);
    if(isNaN(v)||v<=0) return alert('Invalid budget');
    monthlyBudget=v;
    db.collection('users').doc(auth.currentUser.uid).set({ monthlyBudget },{merge:true});
    showToast('Budget updated');
  };
  document.getElementById('add-expense-btn').onclick = ()=>{
    const desc=document.getElementById('expenseInput').value.trim();
    const amt=parseFloat(document.getElementById('amountInput').value);
    const cat=document.getElementById('categoryInput').value;
    if(!desc||isNaN(amt)||amt<=0) return alert('Invalid expense');
    db.collection('users').doc(auth.currentUser.uid).collection('expenses')
      .add({ description:desc,amount:amt,category:cat,date:firebase.firestore.FieldValue.serverTimestamp() });
  };
  
  // Delete / Edit inside updateExpenseList
  function updateExpenseList(){
    const ul=document.getElementById('expenseList'); ul.innerHTML='';
    expenses.forEach(e=>{
      const li=document.createElement('li');
      li.textContent=`${e.description} (${e.category}) - ₹${e.amount}`;
      const ed=document.createElement('button');ed.textContent='Edit';
      ed.onclick=()=>{ const nd=prompt('Desc',e.description),na=parseFloat(prompt('Amt',e.amount));
        if(nd&&!isNaN(na)&&na>0) db.collection('users').doc(auth.currentUser.uid)
          .collection('expenses').doc(e.id).update({description:nd,amount:na});
      };
      const dl=document.createElement('button');dl.textContent='Delete';
      dl.onclick=()=>db.collection('users').doc(auth.currentUser.uid)
        .collection('expenses').doc(e.id).delete();
      li.appendChild(ed);li.appendChild(dl);ul.appendChild(li);
    });
  }
  function updateTotalAmount(){
    const t=expenses.reduce((s,e)=>s+e.amount,0);
    document.getElementById('totalAmount').textContent=t.toFixed(2);
  }
  function updateRemainingBudget(){
    const used=expenses.reduce((s,e)=>s+e.amount,0), rem=monthlyBudget-used;
    const el=document.getElementById('remainingBudget');
    el.textContent=`₹${rem.toFixed(2)}`;el.style.color=rem<0?'red':'#98FB98';
    if(rem<monthlyBudget*0.8) showToast('Spent over 80% of budget');
  }
  
  // --------- History Chart ----------
  let historyChart=null;
  function renderHistoryChart(labels,data){
    const ctx=document.getElementById('historyChart').getContext('2d');
    if(historyChart){ historyChart.data.labels=labels;historyChart.data.datasets[0].data=data;historyChart.update();}
    else historyChart=new Chart(ctx,{
      type:'line',
      data:{labels,datasets:[{label:'Monthly Spend',data,fill:false,borderColor:'#87CEFA'}]},
      options:{animation:{duration:1000},responsive:true}
    });
  }
  
  // --------- Category Budgets ----------
  document.getElementById('addCategoryBudget').onclick=()=>{
    const cat=prompt('Category?'),lim=parseFloat(prompt('Limit?'));
    if(cat&&lim>0){
      const obj={}; obj[`categoryBudgets.${cat}`]=lim;
      db.collection('users').doc(auth.currentUser.uid).set(obj,{merge:true});
      showToast(`Set ${cat} limit ₹${lim}`);
    }
  };
  function renderCategoryBudgets(cb){
    const div=document.getElementById('categoryBudgetList');div.innerHTML='';
    for(let cat in cb){
      const p=document.createElement('p');p.textContent=`${cat}: ₹${cb[cat]}`;div.appendChild(p);
      // check alerts
      const spent=expenses.filter(e=>e.category===cat).reduce((s,e)=>s+e.amount,0);
      if(spent>cb[cat]*0.8) showToast(`Over 80% of ${cat} budget`);
    }
  }
  
  // --------- Recurring Expenses ----------
  document.getElementById('addRecurring').onclick=()=>{
    const desc=prompt('Desc?'),amt=parseFloat(prompt('Amt?')),cat=prompt('Cat?');
    if(desc&&amt>0&&cat){
      db.collection('users').doc(auth.currentUser.uid).collection('recurring')
        .add({description:desc,amount:amt,category:cat,dayOfMonth:new Date().getDate()});
      showToast('Recurring added');
    }
  };
  function renderRecurring(){
    const ul=document.getElementById('recurringList');ul.innerHTML='';
    recurrences.forEach(r=>{
      const li=document.createElement('li');
      li.textContent=`${r.description} (${r.category}) - ₹${r.amount}`;
      const dl=document.createElement('button');dl.textContent='Delete';
      dl.onclick=()=>db.collection('users').doc(auth.currentUser.uid)
        .collection('recurring').doc(r.id).delete();
      li.appendChild(dl);ul.appendChild(li);
    });
  }
  
  // --------- Profile ---------
  function applyProfile(p){
    if(p.displayName) document.title=p.displayName+"'s Finance";
    if(p.avatarUrl) document.body.style.setProperty('--avatar',`url(${p.avatarUrl})`);
    if(p.theme==='light') document.body.classList.add('light-mode'); else document.body.classList.remove('light-mode');
  }
  document.getElementById('saveProfile').onclick=()=>{
    const profile={
      displayName:document.getElementById('displayName').value,
      avatarUrl:document.getElementById('avatarUrl').value,
      theme:document.getElementById('themeSelect').value
    };
    db.collection('users').doc(auth.currentUser.uid).set({profile},{merge:true});
    showToast('Profile saved');
  };
  
  // --------- Export CSV ---------
  document.getElementById('export-btn').onclick=()=>{
    const hdr=['Desc','Cat','Amt','Budget','Rem'];
    const rows=expenses.map(e=>[e.description,e.category,e.amount,monthlyBudget,(monthlyBudget-expenses.reduce((s,x)=>s+x.amount,0)).toFixed(2)]);
    const csv=[hdr,...rows].map(r=>r.join(',')).join('\n');
    const b=new Blob([csv],{type:'text/csv'}),a=document.createElement('a');
    a.href=URL.createObjectURL(b);a.download='finance.csv';a.click();
  };
  
  // --------- Graph.js for Budget Pie ---------
  function renderChart(){
    const ctx=document.getElementById('expenseChart').getContext('2d');
    const cats=[...new Set(expenses.map(e=>e.category))];
    const data=cats.map(c=>expenses.filter(e=>e.category===c).reduce((s,e)=>s+e.amount,0));
    if(chart){chart.data.labels=cats;chart.data.datasets[0].data=data;chart.update();}
    else chart=new Chart(ctx,{
      type:'pie',
      data:{labels:cats,datasets:[{data,backgroundColor:['#FFB6C1','#87CEFA','#98FB98','#FFD700','#D8BFD8'],borderWidth:2}]},
      options:{animation:{animateScale:true,animateRotate:true,duration:1000},responsive:true}
    });
  }
  
  // --------- Toast Utility ---------
  function showToast(msg){
    const t=document.createElement('div');t.className='toast';t.textContent=msg;
    toastContainer.appendChild(t);
    setTimeout(()=>t.classList.add('visible'),10);
    setTimeout(()=>t.remove(),4000);
  }
  

