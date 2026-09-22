import { createApp } from 'vue';
import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi';
import { ko } from 'vuetify/locale';
import '@mdi/font/css/materialdesignicons.css';
import '@fontsource/nanum-brush-script/400.css';
import App from './App.vue';
import './style.css';

const vuetify = createVuetify({
  locale: {
    locale: 'ko',
    fallback: 'ko',
    messages: { ko },
  },
  date: {
    locale: { ko: 'ko-KR' },
  },
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: 'sunseat',
    themes: {
      sunseat: {
        dark: false,
        colors: {
          primary: '#111827',
          secondary: '#0b84f3',
          surface: '#ffffff',
          background: '#f5f5f7',
          accent: '#ffc400',
        },
      },
    },
  },
});

createApp(App).use(vuetify).mount('#app');
