import type { WorkerScope } from "./protocol";
import { serve } from "./serve";

serve(self as unknown as WorkerScope);
