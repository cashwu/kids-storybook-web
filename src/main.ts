import { createApp } from 'vue'
import App from './App.vue'
import { httpsRedirectTarget } from './httpsRedirect'
import './styles.css'

// 在掛載前導向 https，使用者還沒有機會在 http 頁面輸入 key（PLAN 3.2）。
const httpsTarget = httpsRedirectTarget(window.location.href)
if (httpsTarget) window.location.replace(httpsTarget)
else createApp(App).mount('#app')
