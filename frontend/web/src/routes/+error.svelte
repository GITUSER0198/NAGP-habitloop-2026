<script lang="ts">
  import { page } from '$app/state';
</script>
<section class="card"><h1>{page.status}</h1><p>{page.error?.message ?? 'Something went wrong.'}</p><a href="/dashboard">Back to dashboard</a></section>
