const fs = require('fs');
let code = fs.readFileSync('src/context/AppContext.tsx', 'utf8');

const replacement = `const useLocalStorage = <T,>(key: string, initialValue: T): [T, (value: T) => void] => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn('Error reading localStorage', error);
      return initialValue;
    }
  });

  const setValue = (value: T) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.warn('Error setting localStorage', error);
    }
  };

  return [storedValue, setValue];
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeView, setActiveView] = useLocalStorage<NavView>('p2g_activeView', 'production');
  const [activeBatteryId, setActiveBatteryId] = useLocalStorage<string | null>('p2g_activeBatteryId', 'bat-active-101');
  const [activeOrderId, setActiveOrderId] = useLocalStorage<string | null>('p2g_activeOrderId', 'po-active-101');
`;

code = code.replace(/export const AppProvider: React\.FC<\{ children: React\.ReactNode \}> = \(\{ children \}\) => \{\n  const \[activeView, setActiveView\] = useState<NavView>\('production'\);\n  const \[activeBatteryId, setActiveBatteryId\] = useState<string \| null>\('bat-active-101'\);\n  const \[activeOrderId, setActiveOrderId\] = useState<string \| null>\('po-active-101'\);/, replacement);

fs.writeFileSync('src/context/AppContext.tsx', code);
