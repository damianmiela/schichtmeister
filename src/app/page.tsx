import { Container, Typography, Box } from "@mui/material";

export default function Home() {
  return (
    <Container maxWidth="md">
      <Box sx={{ my: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom>
          SchichtMeister DienstPlanner
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Care Facility Shift Planning Application
        </Typography>
      </Box>
    </Container>
  );
}
