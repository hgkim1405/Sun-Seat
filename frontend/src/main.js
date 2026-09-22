import { createApp } from 'vue';
import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import App from './App.vue';
import './style.css';

const vuetify = createVuetify({
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
