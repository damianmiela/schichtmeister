import { Container, Typography, Box, Paper } from "@mui/material";

export default function Home() {
  return (
    <Container maxWidth="md">
      <Box sx={{ my: 4 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Typography variant="h3" component="h1" gutterBottom>
            SchichtMeister DienstPlanner
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Care Facility Shift Planning Application
          </Typography>
          <Typography variant="body2" sx={{ mt: 2 }} color="text.disabled">
            Version 0.1.0 - MVP Setup Complete
          </Typography>
        </Paper>
      </Box>
    </Container>
  );
}
